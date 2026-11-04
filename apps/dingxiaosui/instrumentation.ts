export async function register(){
 // Existing deployments keep their current behavior unless explicitly enabled.
 // Imports stay inside this branch so Edge builds never load Node timers/SQLite.
 if(process.env.NEXT_RUNTIME!=='nodejs'||process.env.MEDIA_BACKGROUND_ENABLED==='0')return;
 const [{startMediaReconciler},{reconcilePendingMediaJobs}]=await Promise.all([
  import('./runtime/media-reconciler.mjs'),
  import('./lib/media-jobs'),
 ]);
 // Registration returns before the first bounded round, leaving server startup
 // independent of provider response time. Durable leases coordinate with the UI.
 startMediaReconciler(()=>reconcilePendingMediaJobs());
}
