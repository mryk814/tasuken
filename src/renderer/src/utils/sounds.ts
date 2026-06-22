let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function playCompleteSound(): void {
  try {
    const ac = getCtx();
    const now = ac.currentTime;

    const osc1 = ac.createOscillator();
    const osc2 = ac.createOscillator();
    const gain = ac.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.setValueAtTime(1320, now + 0.08);

    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1100, now + 0.06);
    osc2.frequency.setValueAtTime(1760, now + 0.12);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ac.destination);

    osc1.start(now);
    osc2.start(now + 0.06);
    osc1.stop(now + 0.25);
    osc2.stop(now + 0.25);
  } catch {
    // Audio not available
  }
}
