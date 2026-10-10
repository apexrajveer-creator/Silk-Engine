// Match display pixels, with an explicit allocation budget for unusually large screens.
export function canvasSize(width,height,dpr=1,maxPixels=8_294_400,maxEdge=4096){
  width=Number.isFinite(width)&&width>0?width:1;height=Number.isFinite(height)&&height>0?height:1;
  dpr=Number.isFinite(dpr)&&dpr>0?dpr:1;
  const scale=Math.min(dpr,maxEdge/width,maxEdge/height,Math.sqrt(maxPixels/(width*height)));
  return{width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export function previewWidth(width=480,height=270,dpr=1){
  const size=canvasSize(width,height,dpr);
  return Math.min(3840,Math.max(640,Math.ceil(Math.max(size.width,size.height*16/9)/320)*320));
}
export function fittedMediaSize(width,height,target){
  const factor=Math.min(1,target/Math.max(1,width));
  return canvasSize(width*factor,height*factor,1);
}
