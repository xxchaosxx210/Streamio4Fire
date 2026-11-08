import {MediaSource, SourceBuffer, VideoPlayer, W3CLibPolyfill} from '@amazon-devices/react-native-w3cmedia';

/** Only app-owned torrent URLs can use the bounded on-device stream-copy helper. */
export class RemuxPlayback {
  private source=new MediaSource();
  private buffer: SourceBuffer|null=null;
  private controller=new AbortController();
  private timer: ReturnType<typeof setInterval>|undefined;
  private objectUrl='';
  private loading=false;
  private stopped=false;
  private finished=false;
  private next:number|null=null;
  private ends: number[]=[];
  constructor(private player:VideoPlayer,private endpoint:string,private duration:number,private onError:(message:string)=>void) {}
  private wait(target: MediaSource|SourceBuffer,event:string,action:()=>void,timeout=10000):Promise<void> {
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);target.removeEventListener(event,done);target.removeEventListener('error',failed);this.controller.signal.removeEventListener('abort',failed);};
      const done=()=>{cleanup();resolve();};const failed=()=>{cleanup();reject(Error('Media preparation was interrupted'));};
      const timer=setTimeout(failed,timeout);target.addEventListener(event,done);target.addEventListener('error',failed);this.controller.signal.addEventListener('abort',failed,{once:true});
      try {action();}catch(error){cleanup();reject(error);}
    });
  }
  private async section(at:number) {
    this.loading=true;
    try {
      const response=await fetch(`${this.endpoint}?start=${Math.max(0,at).toFixed(3)}`,{signal:this.controller.signal});
      if(!response.ok) {const data=await response.json().catch(()=>null);throw Error(data?.error || 'This part of the video could not be loaded.');}
      const codecs=response.headers.get('x-streamio-codecs');
      const offsetHeader=response.headers.get('x-streamio-timestamp-offset');
      const offset=Number(offsetHeader);
      const next=response.headers.get('x-streamio-next');
      this.next=next===null?null:Number(next);
      if(this.next!==null && (!Number.isFinite(this.next) || this.next<=at))throw Error('The next video section could not be identified.');
      if(offsetHeader===null || !Number.isFinite(offset) || offset>0 || offset < -10000)throw Error('The video timing could not be identified.');
      if(!codecs)throw Error('The video format could not be identified.');
      const bytes=await response.arrayBuffer();if(this.stopped)return;
      if(bytes.byteLength>16*1024*1024)throw Error('This video section exceeds the playback memory limit.');
      if(!this.buffer){
        const mime=`video/mp4; codecs="${codecs}"`;
        if(!MediaSource.isTypeSupported(mime))throw Error('This video or audio format cannot use seeking on this device. Try another source.');
        this.buffer=this.source.addSourceBuffer(mime);
      }
      this.buffer.timestampOffset=offset;
      await this.wait(this.buffer,'updateend',()=>this.buffer!.appendBuffer(bytes));
      if(this.stopped)return;
      const ranges=this.buffer.buffered;
      if(!ranges.length)throw Error('The prepared section contains no playable video.');
      const end=ranges.end(ranges.length-1);
      if(end<=at+0.1)throw Error('This source could not provide the next part of the video.');
      this.ends.push(end);
      // Retain at most three sections behind the current playback point.
      if(this.ends.length>3){const old=this.ends.shift()!;const removeTo=Math.min(old,this.player.currentTime-1);if(removeTo>0)await this.wait(this.buffer,'updateend',()=>this.buffer!.remove(0,removeTo));}
      if(this.next===null || end>=this.duration-0.25){this.finished=true;this.source.endOfStream();}
    }finally{this.loading=false;}
  }
  async start(at:number,paused:boolean) {
    W3CLibPolyfill.install();this.player.pause();
    this.objectUrl=URL.createObjectURL(this.source);
    await this.wait(this.source,'sourceopen',()=>{this.player.src=this.objectUrl;});
    this.source.duration=this.duration;
    await this.section(at);if(this.stopped)return;
    const ranges=this.buffer!.buffered;
    if(!Array.from({length:ranges.length},(_,i)=>at>=ranges.start(i)-0.1 && at<ranges.end(i)).some(Boolean))throw Error('The source did not include the requested time.');
    this.player.currentTime=at;
    if(!paused)await this.player.play();
    this.timer=setInterval(()=>{
      if(this.stopped || this.loading || this.finished || !this.buffer || this.player.paused)return;
      const ranges=this.buffer.buffered;if(!ranges.length)return;
      const end=ranges.end(ranges.length-1);
      if(end-this.player.currentTime<8 && this.next!==null)void this.section(this.next).catch(error=>{if(!this.stopped){this.dispose();this.onError(String(error.message || error));}});
    },500);
  }
  dispose(){this.stopped=true;this.controller.abort();if(this.timer)clearInterval(this.timer);if(this.objectUrl)URL.revokeObjectURL(this.objectUrl);}
}
