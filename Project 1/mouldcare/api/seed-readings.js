import { mockSamples, ingestReading } from './iot.js';
for (const sample of mockSamples) console.log(ingestReading(sample));
