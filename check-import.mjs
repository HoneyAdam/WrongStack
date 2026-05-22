// Check if HybridCompactor is reachable from @wrongstack/core top-level barrel
import('@wrongstack/core').then(m => {
  console.log('Has HybridCompactor:', 'HybridCompactor' in m);
  console.log('Keys with Compactor:', Object.keys(m).filter(k => k.toLowerCase().includes('compact')));
  if (!('HybridCompactor' in m)) {
    console.log('\nAvailable keys:', Object.keys(m).sort().join(', '));
  }
}).catch(e => console.error('ERROR:', e.message));