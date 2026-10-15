// Pure helpers for note quick-chips; kept separate so they can be tested without a browser.
/** Add a phrase after the student's own text with one separator, without touching what they typed. */
export function appendChip(value:string,chip:string){const base=value.trimEnd();const next=base?`${base}${/[，,；;。]$/.test(base)?'':'，'}${chip}`:chip;return next.length<=120?next:value;}
/** Remove exactly that phrase and the separator next to it; everything else stays as typed. */
export function removeChip(value:string,chip:string){
  const at=value.indexOf(chip);if(at<0)return value;
  let start=at,end=at+chip.length;
  if(start>0&&/[，,；;]/.test(value[start-1]))start--;else if(end<value.length&&/[，,；;]/.test(value[end]))end++;
  return (value.slice(0,start)+value.slice(end)).trim();
}
