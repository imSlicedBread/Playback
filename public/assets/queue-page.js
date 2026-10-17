/** Pure, bounded queue paging. Original lane indexes are kept for reorder actions. */
export const QUEUE_PAGE_SIZE=50;
export function queuePage(list,page=0,query=''){
  const needle=String(query).trim().toLowerCase();
  const matches=[];
  for(let index=0;index<list.length;index++){
    const video=list[index];
    if(!needle||`${video.title} ${video.videoId}`.toLowerCase().includes(needle))matches.push({video,index});
  }
  const pages=Math.max(1,Math.ceil(matches.length/QUEUE_PAGE_SIZE));
  const current=Math.max(0,Math.min(pages-1,Number.isInteger(page)?page:0));
  const start=current*QUEUE_PAGE_SIZE;
  return {page:current,pages,total:matches.length,start,items:matches.slice(start,start+QUEUE_PAGE_SIZE)};
}
