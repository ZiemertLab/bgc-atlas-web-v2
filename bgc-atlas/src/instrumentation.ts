// Runs once when the Next.js server starts (Node.js runtime, unlike middleware).

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Started on boot so jobs queued across a restart still run. Every server joins the same
    // Redis queue: set SEARCH_WORKER_DISABLED=1 in a non-production checkout so it does not
    // consume production jobs.
    if (process.env.SEARCH_WORKER_DISABLED === '1') {
      console.log('• Search worker disabled (SEARCH_WORKER_DISABLED=1)');
      return;
    }

    try {
      const { initializeWorker } = await import('./lib/queue');
      initializeWorker();
      console.log('✓ Search worker initialized');
    } catch (e) {
      console.error('Failed to initialize search worker on boot:', e);
    }
  }
}
