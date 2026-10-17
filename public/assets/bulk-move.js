/**
 * Move arbitrarily many selected queue IDs through bounded, acknowledged API
 * batches. The server's 500-entry transaction limit is intentional: each
 * successful batch commits durably before progress is reported. A failed batch
 * leaves the unconfirmed IDs available for retry; earlier batches stay moved.
 */
export const BULK_MOVE_BATCH_SIZE = 250;
export const BULK_MOVE_REQUEST_LIMIT = 500;

export async function moveInBatches(ids, destination, {
  submit, onProgress=()=>{}, onBatchComplete=()=>{},
  shouldStop=()=>false, batchSize=BULK_MOVE_BATCH_SIZE
}={}) {
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)
    throw new Error('Select at least one unique queue entry');
  if(typeof submit!=='function')throw new Error('Bulk move submit handler is required');
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>BULK_MOVE_REQUEST_LIMIT)
    throw new Error(`Batch size must be 1–${BULK_MOVE_REQUEST_LIMIT}`);
  const total=ids.length, batchCount=Math.ceil(total/batchSize);
  let moved=0, batchesCompleted=0;
  const notify=(status,batch=0,error='')=>onProgress({status,total,moved,remaining:total-moved,
    percent:Math.round(moved*100/total),batch,batchCount,batchesCompleted,error});
  notify('starting');
  while(moved<total){
    if(shouldStop()){
      notify('cancelled',batchesCompleted);
      return {status:'cancelled',moved,total,remaining:ids.slice(moved),batchesCompleted};
    }
    const batch=batchesCompleted+1, selected=ids.slice(moved,moved+batchSize);
    notify('sending',batch);
    try {await submit(selected,destination);}
    catch(error){
      notify('failed',batch,error?.message||'Unknown server error');
      const failure=new Error(error?.message||'Bulk move failed');
      failure.cause=error;
      failure.moved=moved;
      failure.total=total;
      failure.remaining=ids.slice(moved);
      failure.failedBatch=batch;
      failure.batchesCompleted=batchesCompleted;
      throw failure;
    }
    // Confirmed server response: the batch is durably committed.
    moved+=selected.length;
    batchesCompleted++;
    onBatchComplete(selected);
    notify('confirmed',batch);
  }
  notify('complete',batchesCompleted);
  return {status:'complete',moved,total,remaining:[],batchesCompleted};
}