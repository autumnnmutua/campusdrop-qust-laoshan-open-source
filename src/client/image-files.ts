/** Image files from a paste or drop event, if any. */
export function imageFiles(list:DataTransferItemList|FileList|null|undefined):File[]{
  if(!list)return [];
  const files:File[]=[];
  for(const item of Array.from(list as ArrayLike<DataTransferItem|File>)){
    const file='getAsFile' in item?(item.kind==='file'?item.getAsFile():null):item;
    if(file&&file.type.startsWith('image/'))files.push(file);
  }
  return files;
}
