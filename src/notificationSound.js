const patterns = {
  'urgent-siren': {
    tones: [{ start: 540, end: 920, duration: 0.34 }, { start: 920, end: 540, duration: 0.34 }],
    gap: 0.08,
    type: 'sawtooth',
    volume: 0.16
  },
  'pulse-chime': {
    tones: [{ start: 880, duration: 0.14 }, { start: 660, duration: 0.14 }, { start: 880, duration: 0.14 }],
    gap: 0.1,
    type: 'sine',
    volume: 0.13
  },
  'radar-beep': {
    tones: [{ start: 1260, duration: 0.09 }, { start: 1260, duration: 0.09 }],
    gap: 0.24,
    type: 'square',
    volume: 0.08
  },
  'gentle-bell': {
    tones: [{ start: 784, duration: 0.32 }, { start: 988, duration: 0.48 }],
    gap: 0.12,
    type: 'sine',
    volume: 0.12
  }
};

let audioContext = null;
let activeAudio = null;
let activeOscillators = new Set();
let repeatTimer = null;
let soundSequence = 0;

function stopCurrentSound() {
  soundSequence += 1;
  if (repeatTimer) clearTimeout(repeatTimer);
  repeatTimer = null;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
  }
  activeAudio = null;
  activeOscillators.forEach(oscillator => {
    try {
      oscillator.stop();
    } catch {}
  });
  activeOscillators.clear();
}

function getAudioContext() {
  const AudioContextType = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextType) throw new Error('Web Audio is not supported in this browser.');
  if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextType();
  return audioContext;
}

function playPattern(context, sound) {
  const pattern = patterns[sound] || patterns['gentle-bell'];
  let time = context.currentTime + 0.03;
  pattern.tones.forEach(tone => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = pattern.type;
    oscillator.frequency.setValueAtTime(tone.start, time);
    if (tone.end) oscillator.frequency.linearRampToValueAtTime(tone.end, time + tone.duration);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(pattern.volume, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + tone.duration);
    oscillator.connect(gain).connect(context.destination);
    activeOscillators.add(oscillator);
    oscillator.addEventListener('ended', () => activeOscillators.delete(oscillator), { once: true });
    oscillator.start(time);
    oscillator.stop(time + tone.duration + 0.02);
    time += tone.duration + pattern.gap;
  });
  return time - context.currentTime;
}

export function stopNotificationSound() {
  stopCurrentSound();
  if (audioContext?.state === 'running') void audioContext.suspend();
}

export async function playNotificationSound(sound, customDataUrl = '', { loop = false } = {}) {
  stopCurrentSound();
  const sequence = soundSequence;
  if (sound === 'custom' && customDataUrl) {
    const audio = new Audio(customDataUrl);
    activeAudio = audio;
    audio.loop = loop;
    await audio.play();
    return;
  }

  const context = getAudioContext();
  await context.resume();
  const play = () => {
    if (sequence !== soundSequence) return;
    const duration = playPattern(context, sound);
    if (loop) repeatTimer = setTimeout(play, Math.max(1000, duration * 1000 + 250));
  };
  play();
}
