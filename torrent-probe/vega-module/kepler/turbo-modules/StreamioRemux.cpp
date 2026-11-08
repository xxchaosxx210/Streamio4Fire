// Bounded, stream-copy MP4 sections. Decoding and encoding are deliberately absent.
#include "StreamioRemux.h"
extern "C" {
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/error.h>
#include <libavutil/mem.h>
#include <libavutil/log.h>
}
#include <chrono>
#include <cmath>
#include <algorithm>
#include <cstdint>
#include <memory>
#include <vector>

struct Section {
    Write write;
    void* output;
    Cancel cancel;
    void* cancellation;
    std::chrono::steady_clock::time_point deadline;
};
static int interrupted(void* opaque) {
    auto* section=static_cast<Section*>(opaque);
    return section->cancel(section->cancellation) || std::chrono::steady_clock::now()>=section->deadline;
}
static int writeBytes(void* opaque, const uint8_t* bytes, int size) {
    auto* section=static_cast<Section*>(opaque);
    if(interrupted(opaque)) return AVERROR_EXIT;
    return section->write(section->output,bytes,size);
}
struct PacketDeleter {void operator()(AVPacket* packet) const {av_packet_free(&packet);}};
using Packet=std::unique_ptr<AVPacket,PacketDeleter>;

extern "C" int streamio_remux_section(const StreamioInput* reader, double start, Write write, void* output, Cancel cancel, void* cancellation, double* presentationOffset, double* nextStart) {
    av_log_set_level(AV_LOG_ERROR);
    *presentationOffset=0;*nextStart=-1;
    Section section{write,output,cancel,cancellation,std::chrono::steady_clock::now()+std::chrono::seconds(75)};
    AVFormatContext* input=avformat_alloc_context();
    AVFormatContext* mux=nullptr;
    AVIOContext* io=nullptr;
    AVIOContext* inputIo=nullptr;
    AVPacket* packet=nullptr;
    AVDictionary* options=nullptr;
    int result=AVERROR(ENOMEM);
    if(!input) return result;
    input->interrupt_callback={interrupted,&section};
    {
        auto* bytes=static_cast<unsigned char*>(av_malloc(65536));
        if(!bytes)goto done;
        inputIo=avio_alloc_context(bytes,65536,0,reader->opaque,reader->read,nullptr,reader->seek);
        if(!inputIo){av_free(bytes);goto done;}
        inputIo->seekable=AVIO_SEEKABLE_NORMAL;
        input->pb=inputIo;input->flags|=AVFMT_FLAG_CUSTOM_IO;
    }
    av_dict_set(&options,"probesize","5000000",0);
    result=avformat_open_input(&input,nullptr,nullptr,&options);
    av_dict_free(&options);
    if(result<0) goto done;
    result=avformat_find_stream_info(input,nullptr);
    if(result<0) goto done;
    {
        int video=-1,audio=-1;
        for(unsigned i=0;i<input->nb_streams;i++) {
            const auto type=input->streams[i]->codecpar->codec_type;
            if(type==AVMEDIA_TYPE_VIDEO && video<0)video=static_cast<int>(i);
            if(type==AVMEDIA_TYPE_AUDIO && audio<0)audio=static_cast<int>(i);
        }
        if(video<0){result=AVERROR_STREAM_NOT_FOUND;goto done;}
        const int64_t origin=input->start_time==AV_NOPTS_VALUE?0:input->start_time;
        const int64_t target=static_cast<int64_t>(start*AV_TIME_BASE)+origin;
        if(start>0) {
            result=av_seek_frame(input,video,av_rescale_q(target,AV_TIME_BASE_Q,input->streams[video]->time_base),AVSEEK_FLAG_BACKWARD);
            if(result<0)goto done;
        }
        // Keep one bounded section so decode timestamps can be validated before
        // writing any samples. Stop at a keyframe, not partway through a GOP.
        std::vector<Packet> packets;
        std::vector<AVPacket*> videoPackets;
        packet=av_packet_alloc();
        if(!packet){result=AVERROR(ENOMEM);goto done;}
        int64_t copied=0,lastDts=AV_NOPTS_VALUE;
        bool rebuildDts=false;
        while(!interrupted(&section)) {
            result=av_read_frame(input,packet);
            if(result==AVERROR_EOF){result=0;break;}
            if(result<0)goto done;
            const int index=packet->stream_index;
            if(index!=video && index!=audio){av_packet_unref(packet);continue;}
            AVStream* source=input->streams[index];
            if(packet->pts==AV_NOPTS_VALUE)packet->pts=packet->dts;
            if(packet->pts==AV_NOPTS_VALUE){result=AVERROR_INVALIDDATA;goto done;}
            const int64_t timestamp=av_rescale_q(packet->pts,source->time_base,AV_TIME_BASE_Q)-origin;
            if(index==video && (packet->flags&AV_PKT_FLAG_KEY) &&
               (timestamp>=static_cast<int64_t>((start+24)*AV_TIME_BASE) || copied>=8*1024*1024)) {
                *nextStart=static_cast<double>(timestamp)/AV_TIME_BASE;
                av_packet_unref(packet);result=0;break;
            }
            copied+=packet->size;
            if(copied>12*1024*1024 || packets.size()>=16384){result=AVERROR(ENOMEM);goto done;}
            const int64_t originTicks=av_rescale_q(origin,AV_TIME_BASE_Q,source->time_base);
            packet->pts-=originTicks;
            if(packet->dts!=AV_NOPTS_VALUE)packet->dts-=originTicks;
            if(index==video) {
                if(packet->dts==AV_NOPTS_VALUE || packet->dts>packet->pts ||
                   (lastDts!=AV_NOPTS_VALUE && packet->dts<=lastDts))rebuildDts=true;
                lastDts=packet->dts;
            }else if(packet->dts==AV_NOPTS_VALUE)packet->dts=packet->pts;
            Packet saved(av_packet_clone(packet));
            if(!saved){result=AVERROR(ENOMEM);goto done;}
            if(index==video)videoPackets.push_back(saved.get());
            packets.push_back(std::move(saved));av_packet_unref(packet);
        }
        if(interrupted(&section)){result=AVERROR_EXIT;goto done;}
        if(videoPackets.empty()){result=AVERROR_INVALIDDATA;goto done;}
        if(rebuildDts) {
            // Some Matroska demuxers report reordered PTS as DTS. Preserve the
            // original PTS and packet/decode order; derive a strictly increasing
            // decode clock from the actual presentation cadence, including VFR.
            std::vector<int64_t> ordered;
            for(auto* item:videoPackets)ordered.push_back(item->pts);
            std::sort(ordered.begin(),ordered.end());
            int64_t delay=1;
            for(size_t i=0;i<ordered.size();i++) {
                if(i && ordered[i]<=ordered[i-1])ordered[i]=ordered[i-1]+1;
                delay=std::max(delay,ordered[i]-videoPackets[i]->pts+1);
            }
            for(size_t i=0;i<ordered.size();i++)videoPackets[i]->dts=ordered[i]-delay;
        }
        int64_t earliest=0;
        for(const auto& item:packets)earliest=std::min(earliest,av_rescale_q(item->dts,input->streams[item->stream_index]->time_base,AV_TIME_BASE_Q));
        const double offset=earliest<0?std::ceil(-static_cast<double>(earliest)/AV_TIME_BASE)+1:0;
        *presentationOffset=offset;
        result=avformat_alloc_output_context2(&mux,nullptr,"mp4",nullptr);
        if(result<0 || !mux){result=AVERROR(ENOMEM);goto done;}
        {
            auto* bytes=static_cast<unsigned char*>(av_malloc(65536));
            if(!bytes){result=AVERROR(ENOMEM);goto done;}
            io=avio_alloc_context(bytes,65536,1,&section,nullptr,writeBytes,nullptr);
            if(!io){av_free(bytes);result=AVERROR(ENOMEM);goto done;}
        }
        mux->pb=io;mux->flags|=AVFMT_FLAG_CUSTOM_IO;
        mux->avoid_negative_ts=AVFMT_AVOID_NEG_TS_DISABLED;
        std::vector<int> mapping(input->nb_streams,-1);
        for(unsigned i=0;i<input->nb_streams;i++) {
            if(static_cast<int>(i)!=video && static_cast<int>(i)!=audio)continue;
            AVStream* stream=avformat_new_stream(mux,nullptr);
            if(!stream){result=AVERROR(ENOMEM);goto done;}
            mapping[i]=stream->index;
            result=avcodec_parameters_copy(stream->codecpar,input->streams[i]->codecpar);
            if(result<0)goto done;
            stream->codecpar->codec_tag=0;
            stream->time_base=input->streams[i]->time_base;
            stream->avg_frame_rate=input->streams[i]->avg_frame_rate;
        }
        av_dict_set(&options,"movflags","frag_keyframe+empty_moov+delay_moov+default_base_moof+frag_discont",0);
        av_dict_set(&options,"use_editlist","0",0);
        result=avformat_write_header(mux,&options);av_dict_free(&options);
        if(result<0)goto done;
        for(auto& item:packets) {
            AVPacket* current=item.get();
            const int index=current->stream_index;
            AVStream* source=input->streams[index];
            const int64_t shift=av_rescale_q(static_cast<int64_t>(offset*AV_TIME_BASE),AV_TIME_BASE_Q,source->time_base);
            current->pts+=shift;current->dts+=shift;
            AVStream* destination=mux->streams[mapping[index]];
            av_packet_rescale_ts(current,source->time_base,destination->time_base);
            current->stream_index=mapping[index];current->pos=-1;
            result=av_interleaved_write_frame(mux,current);
            if(result<0)goto done;
        }
        if(interrupted(&section)){result=AVERROR_EXIT;goto done;}
        result=av_write_trailer(mux);
        avio_flush(io);
        if(result>=0 && io->error<0)result=io->error;
    }
done:
    av_dict_free(&options);
    av_packet_free(&packet);
    if(mux)avformat_free_context(mux);
    if(io){av_freep(&io->buffer);avio_context_free(&io);}
    avformat_close_input(&input);
    if(inputIo){av_freep(&inputIo->buffer);avio_context_free(&inputIo);}
    return result;
}
