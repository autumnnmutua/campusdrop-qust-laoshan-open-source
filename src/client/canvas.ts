/** Rounded-rectangle path with a plain-rectangle fallback for browsers without CanvasRenderingContext2D.roundRect. */
export function roundRectPath(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  c.beginPath();if(typeof c.roundRect==='function')c.roundRect(x,y,w,h,r);else c.rect(x,y,w,h);
}
