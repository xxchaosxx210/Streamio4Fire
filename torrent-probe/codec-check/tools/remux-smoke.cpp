// Host integration check: the exact native implementation, generated media only.
extern "C" {
#include <libavformat/avformat.h>
}
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <vector>
#include "StreamioRemux.h"
static int readInput(void* context,uint8_t* bytes,int size){auto* file=static_cast<FILE*>(context);const size_t read=std::fread(bytes,1,size,file);return read?static_cast<int>(read):std::ferror(file)?-5:AVERROR_EOF;}
static int64_t seekInput(void* context,int64_t offset,int whence){auto* file=static_cast<FILE*>(context);if(whence&AVSEEK_SIZE){const auto saved=ftello(file);fseeko(file,0,SEEK_END);const auto size=ftello(file);fseeko(file,saved,SEEK_SET);return size;}return fseeko(file,offset,whence&~AVSEEK_FORCE)<0?-5:ftello(file);}
struct Output {std::vector<uint8_t> bytes;size_t limit=16*1024*1024;};
static int write(void* context,const uint8_t* data,int size) {
    auto& output=*static_cast<Output*>(context);
    if(size<0 || output.bytes.size()+size>output.limit)return -12;
    output.bytes.insert(output.bytes.end(),data,data+size);return size;
}
static int cancel(void* context){return *static_cast<bool*>(context);}
struct Timeline {std::vector<double> video,audio;};
static bool readTimeline(const char* file,double offset,Timeline& timeline,bool checkDts) {
    AVFormatContext* input=nullptr;
    if(avformat_open_input(&input,file,nullptr,nullptr)<0)return false;
    if(avformat_find_stream_info(input,nullptr)<0){avformat_close_input(&input);return false;}
    const double origin=checkDts?offset:input->start_time==AV_NOPTS_VALUE?0:static_cast<double>(input->start_time)/AV_TIME_BASE;
    std::vector<int64_t> last(input->nb_streams,AV_NOPTS_VALUE);
    AVPacket* packet=av_packet_alloc();bool valid=true;
    while(av_read_frame(input,packet)>=0) {
        auto* stream=input->streams[packet->stream_index];
        if(checkDts && packet->dts!=AV_NOPTS_VALUE) {
            auto& previous=last[packet->stream_index];
            if(previous!=AV_NOPTS_VALUE && packet->dts<=previous)valid=false;
            previous=packet->dts;
        }
        if(packet->pts!=AV_NOPTS_VALUE) {
            const double pts=packet->pts*av_q2d(stream->time_base)-origin;
            if(stream->codecpar->codec_type==AVMEDIA_TYPE_VIDEO)timeline.video.push_back(pts);
            if(stream->codecpar->codec_type==AVMEDIA_TYPE_AUDIO)timeline.audio.push_back(pts);
        }
        av_packet_unref(packet);
    }
    av_packet_free(&packet);avformat_close_input(&input);return valid;
}
static bool preserved(std::vector<double> source,const std::vector<double>& output) {
    std::sort(source.begin(),source.end());
    for(double pts:output) {
        auto match=std::lower_bound(source.begin(),source.end(),pts-0.002);
        if(match==source.end() || std::abs(*match-pts)>0.002)return false;
    }
    return !output.empty();
}
int main(int argc,char** argv) {
    if(argc<4)return 2;
    const double at=std::atof(argv[2]);bool cancelled=argc>4;
    Output output;double offset=0,next=-1;
    FILE* sourceFile=std::fopen(argv[1],"rb");if(!sourceFile)return 1;
    StreamioInput reader{readInput,seekInput,sourceFile};
    const int status=streamio_remux_section(&reader,at,write,&output,cancel,&cancelled,&offset,&next);
    std::fclose(sourceFile);
    if(cancelled)return status<0 && output.bytes.empty()?0:1;
    if(status<0 || output.bytes.empty())return 1;
    FILE* file=std::fopen(argv[3],"wb");if(!file)return 1;
    std::fwrite(output.bytes.data(),1,output.bytes.size(),file);std::fclose(file);
    Timeline source,result;
    if(!readTimeline(argv[1],0,source,false) || !readTimeline(argv[3],offset,result,true))return 1;
    if(!preserved(source.video,result.video) || !preserved(source.audio,result.audio))return 1;
    const auto bounds=std::minmax_element(result.video.begin(),result.video.end());
    if(*bounds.first>at+0.1 || *bounds.second<at-0.1)return 1;
    std::printf("Seek %.2fs: preserved picture/audio PTS, monotonic DTS, %zu bytes\n",at,output.bytes.size());
    return 0;
}
