const wikipediaImage = async (title) => {
  const endpoint = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const response = await fetch(endpoint);
    if (!response.ok) return null;
    const page = await response.json();
    return page.thumbnail?.source ?? null;
  } catch {
    return null;
  }
};

document.querySelectorAll('img[data-wiki]').forEach(async (image) => {
  const source = await wikipediaImage(image.dataset.wiki);
  if (source) image.src = source;
  else image.closest('.album-art, .member-card')?.classList.add('image-unavailable');
});

document.querySelectorAll('.filter-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter-button').forEach((filter) => {
      const selected = filter === button;
      filter.classList.toggle('is-active', selected);
      filter.setAttribute('aria-pressed', String(selected));
    });

    document.querySelectorAll('.album-card').forEach((card) => {
      const show = button.dataset.filter === 'todos' || card.dataset.era === button.dataset.filter;
      card.classList.toggle('is-hidden', !show);
    });
  });
});

const startButton = document.querySelector('#start-game');
const hitButton = document.querySelector('#hit-button');
const board = document.querySelector('#game-board');
const notesContainer = document.querySelector('#beat-notes');
const overlay = document.querySelector('#board-overlay');
const scoreDisplay = document.querySelector('#score');
const comboDisplay = document.querySelector('#combo');
const clockDisplay = document.querySelector('#game-clock');
const message = document.querySelector('#game-message');
const soundToggle = document.querySelector('#sound-toggle');
const trackSelect = document.querySelector('#track-select');
const difficultySelect = document.querySelector('#difficulty-select');
const trackStatus = document.querySelector('#track-status');
const trackLink = document.querySelector('#track-link');
const syncOffset = document.querySelector('#sync-offset');
const syncValue = document.querySelector('#sync-value');
const hitLine = 0.77;
const gameLength = 30;
const difficulties = {
  hard: { speed: 245, subdivisions: 1, tolerance: 23, pattern: [0, 2], patternLength: 4 },
  expert: { speed: 290, subdivisions: 2, tolerance: 14, pattern: [0, 3, 5], patternLength: 8 }
};
const tracks = {
  'in-the-end': { title: 'In the End', videoId: 'eVTXPUF4Oz4', bpm: 105 },
  numb: { title: 'Numb', videoId: 'kXYiU_JCYtU', bpm: 110 },
  faint: { title: 'Faint', videoId: 'LYU-8IFcDPw', bpm: 135 },
  'what-ive-done': { title: "What I've Done", videoId: '8sgycukafqQ', bpm: 120 }
};
const chartLeadInBeats = 4;
let audioContext;
let soundEnabled = true;
let youtubePlayer;
let youtubeReady = false;
let notes = [];
let score = 0;
let combo = 0;
let lastFrame = 0;
let gameStartedAt = null;
let fallbackStartedAt = 0;
let nextBeatIndex = 0;
let lastMusicTime = null;
let animationFrame = 0;
let playing = false;
let usingYoutube = false;

const selectedTrack = () => tracks[trackSelect.value];

const updateTrackLink = () => {
  const track = selectedTrack();
  trackLink.href = `https://www.youtube.com/watch?v=${track.videoId}`;
  if (youtubeReady) trackStatus.textContent = `${track.title} · ${track.bpm} BPM aprox.`;
};

const createYoutubePlayer = () => {
  const track = selectedTrack();
  const width = document.querySelector('#youtube-player').clientWidth || 360;
  youtubePlayer = new window.YT.Player('youtube-player', {
    width,
    height: Math.round(width * 9 / 16),
    videoId: track.videoId,
    playerVars: { controls: 1, playsinline: 1, rel: 0, origin: window.location.origin },
    events: {
      onReady: () => {
        youtubeReady = true;
        updateTrackLink();
      },
      onStateChange: (event) => {
        if (!playing) return;
        if (event.data === window.YT.PlayerState.PLAYING && gameStartedAt === null) {
          gameStartedAt = youtubePlayer.getCurrentTime();
          lastFrame = performance.now();
          message.textContent = `Acompanhe ${selectedTrack().title} e acerte no tempo.`;
        } else if (event.data === window.YT.PlayerState.PAUSED) {
          message.textContent = 'Faixa pausada. Retome o vídeo para continuar.';
        } else if (event.data === window.YT.PlayerState.ENDED) {
          finishGame();
        }
      },
      onError: () => {
        youtubeReady = false;
        trackStatus.textContent = 'Player indisponível; use o link externo.';
        if (playing && usingYoutube) {
          usingYoutube = false;
          fallbackStartedAt = performance.now();
          gameStartedAt = 0;
          nextBeatIndex = 0;
          clearNotes();
          lastFrame = performance.now();
          message.textContent = `Player indisponível; ritmo em ~${selectedTrack().bpm} BPM.`;
        }
      }
    }
  });
};

window.onYouTubeIframeAPIReady = createYoutubePlayer;
const youtubeApi = document.createElement('script');
youtubeApi.src = 'https://www.youtube.com/iframe_api';
document.head.append(youtubeApi);

const playTone = (frequency, duration, type, volume, offset = 0, endFrequency = frequency) => {
  if (!soundEnabled) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  audioContext ??= new AudioContextClass();
  if (audioContext.state === 'suspended') audioContext.resume();

  const startAt = audioContext.currentTime + offset;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + duration);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.01);
};

const playEffect = (effect) => {
  if (effect === 'start') {
    playTone(392, 0.14, 'triangle', 0.045, 0);
    playTone(587, 0.2, 'triangle', 0.045, 0.13);
  } else if (effect === 'hit') {
    playTone(520, 0.09, 'sine', 0.035);
  } else if (effect === 'perfect') {
    playTone(660, 0.12, 'triangle', 0.05);
    playTone(880, 0.16, 'triangle', 0.04, 0.07);
  } else if (effect === 'miss') {
    playTone(180, 0.18, 'sawtooth', 0.025, 0, 110);
  } else if (effect === 'finish') {
    playTone(440, 0.2, 'triangle', 0.04, 0, 330);
    playTone(330, 0.28, 'triangle', 0.035, 0.18, 220);
  }
};

const formatScore = (value) => String(value).padStart(4, '0');

const clearNotes = () => {
  notes.forEach((note) => note.element.remove());
  notes = [];
};

const finishGame = () => {
  playing = false;
  playEffect('finish');
  window.cancelAnimationFrame(animationFrame);
  if (usingYoutube && youtubePlayer) youtubePlayer.pauseVideo();
  trackSelect.disabled = false;
  difficultySelect.disabled = false;
  syncOffset.disabled = false;
  clearNotes();
  overlay.classList.remove('is-hidden');
  overlay.innerHTML = `<span>FIM DE JOGO<br>${formatScore(score)} PONTOS</span>`;
  message.textContent = combo > 2 ? `Combo máximo: ×${combo}. A batida continua.` : 'Boa! Tente manter a sequência por mais tempo.';
  startButton.innerHTML = '<span aria-hidden="true">↻</span> Jogar de novo';
};

const addNote = () => {
  const element = document.createElement('span');
  element.className = 'beat-note';
  notesContainer.append(element);
  notes.push({ element, y: -14 });
};

const frame = (now) => {
  if (!playing) return;

  if (usingYoutube && (!youtubeReady || youtubePlayer.getPlayerState() !== window.YT.PlayerState.PLAYING)) {
    lastFrame = now;
    animationFrame = window.requestAnimationFrame(frame);
    return;
  }

  const delta = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  const elapsed = usingYoutube
    ? youtubePlayer.getCurrentTime() - gameStartedAt
    : (now - fallbackStartedAt) / 1000;
  const remaining = Math.max(0, gameLength - Math.floor(elapsed));
  clockDisplay.textContent = `00:${String(remaining).padStart(2, '0')}`;
  if (elapsed >= gameLength) {
    finishGame();
    return;
  }

  const difficulty = difficulties[difficultySelect.value];
  const track = selectedTrack();
  const line = board.clientHeight * hitLine;
  const travelTime = (line + 14) / difficulty.speed;
  const beatInterval = 60 / track.bpm / difficulty.subdivisions;
  const firstBeat = (60 / track.bpm) * chartLeadInBeats + Number(syncOffset.value) / 1000;

  if (lastMusicTime !== null && (elapsed < lastMusicTime - 0.2 || elapsed - lastMusicTime > Math.max(0.35, delta + 0.2))) {
    clearNotes();
    combo = 0;
    comboDisplay.textContent = '×0';
    nextBeatIndex = Math.max(0, Math.ceil((elapsed + travelTime - firstBeat) / beatInterval));
    message.textContent = 'Sincronizando com a posição da faixa...';
  }
  lastMusicTime = elapsed;

  while (firstBeat + nextBeatIndex * beatInterval - elapsed <= travelTime) {
    const patternPosition = nextBeatIndex % difficulty.patternLength;
    if (firstBeat + nextBeatIndex * beatInterval >= elapsed - 0.08 && difficulty.pattern.includes(patternPosition)) addNote();
    nextBeatIndex += 1;
  }

  notes = notes.filter((note) => {
    note.y += difficulty.speed * delta;
    note.element.style.top = `${note.y}px`;
    if (note.y > line + 37) {
      note.element.remove();
      combo = 0;
      comboDisplay.textContent = '×0';
      message.textContent = 'A batida passou. Respire e volte.';
      playEffect('miss');
      return false;
    }
    return true;
  });

  animationFrame = window.requestAnimationFrame(frame);
};

const startGame = () => {
  window.cancelAnimationFrame(animationFrame);
  clearNotes();
  score = 0;
  combo = 0;
  gameStartedAt = null;
  nextBeatIndex = 0;
  lastMusicTime = null;
  usingYoutube = youtubeReady;
  fallbackStartedAt = performance.now();
  playing = true;
  trackSelect.disabled = true;
  difficultySelect.disabled = true;
  syncOffset.disabled = true;
  scoreDisplay.textContent = formatScore(score);
  comboDisplay.textContent = '×0';
  clockDisplay.textContent = '00:30';
  message.textContent = usingYoutube ? 'Sincronizando com a faixa...' : `Player indisponível; ritmo em ~${selectedTrack().bpm} BPM.`;
  overlay.classList.add('is-hidden');
  startButton.innerHTML = '<span aria-hidden="true">▶</span> Reiniciar';
  if (usingYoutube) {
    youtubePlayer.seekTo(0, true);
    youtubePlayer.playVideo();
  } else {
    gameStartedAt = 0;
  }
  playEffect('start');
  lastFrame = performance.now();
  animationFrame = window.requestAnimationFrame(frame);
};

const hit = () => {
  if (!playing) return;
  if (usingYoutube && youtubePlayer.getPlayerState() !== window.YT.PlayerState.PLAYING) return;
  const difficulty = difficulties[difficultySelect.value];
  const line = board.clientHeight * hitLine;
  let closestIndex = -1;
  let closestDistance = Infinity;

  notes.forEach((note, index) => {
    const distance = Math.abs(note.y - line);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  if (closestIndex === -1 || closestDistance > difficulty.tolerance) {
    combo = 0;
    comboDisplay.textContent = '×0';
    message.textContent = 'No tempo: espere a batida chegar à linha.';
    playEffect('miss');
    return;
  }

  const [note] = notes.splice(closestIndex, 1);
  note.element.remove();
  combo += 1;
  const points = closestDistance < difficulty.tolerance * 0.4 ? 100 : closestDistance < difficulty.tolerance * 0.75 ? 65 : 35;
  score += points + Math.min(combo - 1, 10) * 5;
  scoreDisplay.textContent = formatScore(score);
  comboDisplay.textContent = `×${combo}`;
  message.textContent = points === 100 ? 'Perfeito. Segure o ritmo.' : 'No tempo. Continue.';
  playEffect(points === 100 ? 'perfect' : 'hit');
};

soundToggle.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundToggle.textContent = soundEnabled ? 'SOM ON' : 'SOM OFF';
  soundToggle.setAttribute('aria-pressed', String(soundEnabled));
  soundToggle.setAttribute('aria-label', soundEnabled ? 'Desativar efeitos sonoros' : 'Ativar efeitos sonoros');
  if (soundEnabled) playTone(520, 0.1, 'sine', 0.035);
});

syncOffset.addEventListener('input', () => {
  const value = Number(syncOffset.value);
  syncValue.textContent = `${value > 0 ? '+' : ''}${value} ms`;
});

trackSelect.addEventListener('change', () => {
  if (playing) finishGame();
  updateTrackLink();
  if (youtubeReady) youtubePlayer.cueVideoById(selectedTrack().videoId);
});

startButton.addEventListener('click', startGame);
hitButton.addEventListener('click', hit);
board.addEventListener('pointerdown', (event) => {
  if (event.target === board || event.target.closest('.beat-lane')) hit();
});
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && !event.repeat) {
    event.preventDefault();
    hit();
  }
});