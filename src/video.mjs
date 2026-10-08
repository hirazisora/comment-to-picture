export function videoMime(file) {
  if(file.type==='video/mp4'||/\.(mp4|m4v)$/i.test(file.name))return 'video/mp4';
  if(file.type==='video/webm'||/\.webm$/i.test(file.name))return 'video/webm';
  return null;
}
export function releaseVideo(element) {
  element.pause();element.removeAttribute('src');element.load();
}
export function formatTime(seconds) {
  const ms=Math.max(0,Math.round((Number.isFinite(seconds)?seconds:0)*1000));
  const hours=Math.floor(ms/3600000),minutes=Math.floor(ms/60000)%60,secs=Math.floor(ms/1000)%60;
  return (hours?String(hours).padStart(2,'0')+':':'')+String(minutes).padStart(2,'0')+':'+String(secs).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');
}
function mediaReady(element,url,event,registerCancel) {
  return new Promise((resolve,reject)=>{
    const finish=error=>{clearTimeout(timer);element.removeEventListener(event,ready);element.removeEventListener('error',failed);error?reject(error):resolve();};
    const ready=()=>finish(),failed=()=>finish(new Error('この動画の形式・コーデックをブラウザで再生できません。'));
    const timer=setTimeout(()=>finish(new Error('動画の読み込み時間が上限を超えました。')),30000);
    element.addEventListener(event,ready,{once:true});element.addEventListener('error',failed,{once:true});
    registerCancel(()=>finish(new Error('cancelled')));
    element.src=url;element.load();
  });
}
export async function inspectVideo(file,registerCancel) {
  const element=document.createElement('video'),url=URL.createObjectURL(file);element.preload='metadata';element.muted=true;
  try {
    if(!element.canPlayType(videoMime(file)))throw new Error('この動画の形式・コーデックをブラウザで再生できません。');
    await mediaReady(element,url,'loadedmetadata',registerCancel);
    const width=element.videoWidth,height=element.videoHeight,duration=element.duration;
    if(!Number.isFinite(duration)||duration<=0||!width||!height)throw new Error('動画の再生時間・解像度を取得できない形式には対応していません。');
    if(width*height>40000000)throw new Error('動画は最大4000万画素までです。');
    return {url,width,height,duration};
  } catch(error){URL.revokeObjectURL(url);throw error;}
  finally {releaseVideo(element);}
}
export const loadVideo=(element,url,registerCancel)=>mediaReady(element,url,'loadeddata',registerCancel);
