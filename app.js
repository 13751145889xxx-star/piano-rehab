/**
 * Piano Rehab - 钢琴复健助手
 * Features: Practice planning, timer, progress tracking, repertoire, recording, AI analysis,
 *           metronome, practice journal, adaptive plan adjustment, PWA
 */

const app = (() => {
  // ========== STATE ==========
  let state = {
    step: 'welcome',
    config: { dailyMinutes: 45, level: 'dusty', goals: [] },
    plan: null, currentWeek: 1, currentDay: 1,
    logs: {}, streak: 0, lastPracticeDate: null,
    timer: { running: false, seconds: 0, totalSeconds: 0, interval: null, exerciseName: '' },
    recording: { isRecording: false, isPaused: false, mediaRecorder: null, audioChunks: [], startTime: 0, pauseTime: 0, stream: null, analyser: null, dataArray: null, animationId: null },
    currentMood: 'normal',
    detailAudio: null,
    // Tier 1: Journal & Metronome
    journal: [],
    journalMood: 'normal',
    metronome: { running: false, bpm: 80, timeSig: '3/4', beat: 0, interval: null, audioCtx: null },
    adaptiveTipDismissed: false
  };

  // Load state
  const saved = localStorage.getItem('pianoRehab');
  if (saved) {
    try {
      const p = JSON.parse(saved);
      state = { ...state, ...p, recording: { ...state.recording }, detailAudio: null, metronome: { ...state.metronome } };
    } catch (e) {}
  }

  const save = () => {
    const toSave = { ...state };
    delete toSave.recording;
    delete toSave.detailAudio;
    delete toSave.metronome;
    localStorage.setItem('pianoRehab', JSON.stringify(toSave));
  };

  // ========== SERVICE WORKER (PWA) ==========
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('SW registered:', reg.scope))
        .catch(err => console.log('SW registration failed:', err));
    }
  }

  // ========== INDEXED DB ==========
  const DB_NAME = 'PianoRehabDB';
  const DB_VERSION = 1;
  let db = null;

  function initDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('recordings')) {
          d.createObjectStore('recordings', { keyPath: 'id', autoIncrement: true });
        }
      };
    });
  }

  function saveRecording(record) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      const store = tx.objectStore('recordings');
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getAllRecordings() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readonly');
      const store = tx.objectStore('recordings');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function deleteRecordingDB(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      const store = tx.objectStore('recordings');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ========== ONBOARDING ==========
  function showStep(id) {
    try {
      const steps = document.querySelectorAll('[id^="step-"]');
      steps.forEach(el => {
        if (el.id !== 'step-' + id) el.classList.add('hidden');
      });
      const target = document.getElementById('step-' + id);
      if (target) {
        target.classList.remove('hidden');
        state.step = id;
        save();
      } else {
        console.error('showStep: target element not found for id:', id);
      }
    } catch (e) {
      console.error('showStep error:', e);
    }
  }
  function nextStep() {
    try {
      const map = { welcome: 'time', time: 'level', level: 'goals', goals: 'generate' };
      if (map[state.step]) showStep(map[state.step]);
      if (state.step === 'generate') updateSummary();
    } catch (e) {
      console.error('nextStep error:', e);
    }
  }
  function prevStep() {
    try {
      const map = { time: 'welcome', level: 'time', goals: 'level', generate: 'goals' };
      if (map[state.step]) showStep(map[state.step]);
    } catch (e) {
      console.error('prevStep error:', e);
    }
  }
  function setTime(m) { state.config.dailyMinutes = m; nextStep(); }
  function setLevel(l) { state.config.level = l; nextStep(); }
  function toggleGoal(btn, goal) {
    try {
      const idx = state.config.goals.indexOf(goal);
      if (idx > -1) { state.config.goals.splice(idx, 1); btn.classList.remove('ring-2', 'ring-accent'); }
      else { state.config.goals.push(goal); btn.classList.add('ring-2', 'ring-accent'); }
      const nextBtn = document.getElementById('goals-next');
      if (nextBtn) {
        nextBtn.disabled = state.config.goals.length === 0;
        nextBtn.classList.toggle('opacity-50', state.config.goals.length === 0);
        nextBtn.classList.toggle('cursor-not-allowed', state.config.goals.length === 0);
      }
      save();
    } catch (e) {
      console.error('toggleGoal error:', e);
    }
  }
  function showStep(id) {
    document.querySelectorAll('#onboarding > div > div').forEach(el => el.classList.add('hidden'));
    document.getElementById('step-' + id).classList.remove('hidden');
    state.step = id; save();
  }
  function nextStep() {
    const map = { welcome: 'time', time: 'level', level: 'goals', goals: 'generate' };
    if (map[state.step]) showStep(map[state.step]);
    if (state.step === 'generate') updateSummary();
  }
  function prevStep() {
    const map = { time: 'welcome', level: 'time', goals: 'level', generate: 'goals' };
    if (map[state.step]) showStep(map[state.step]);
  }
  function setTime(m) { state.config.dailyMinutes = m; nextStep(); }
  function setLevel(l) { state.config.level = l; nextStep(); }
  function toggleGoal(btn, goal) {
    const idx = state.config.goals.indexOf(goal);
    if (idx > -1) { state.config.goals.splice(idx, 1); btn.classList.remove('ring-2', 'ring-accent'); }
    else { state.config.goals.push(goal); btn.classList.add('ring-2', 'ring-accent'); }
    const nextBtn = document.getElementById('goals-next');
    nextBtn.disabled = state.config.goals.length === 0;
    nextBtn.classList.toggle('opacity-50', state.config.goals.length === 0);
    nextBtn.classList.toggle('cursor-not-allowed', state.config.goals.length === 0);
  }
  function updateSummary() {
    const tm = { 30: '30 分钟', 45: '45 分钟', 60: '60 分钟', 90: '90+ 分钟' };
    const lm = { rusty: '生疏期', dusty: '蒙尘期', fading: '褪色期' };
    const gm = { technique: '手指机能', repertoire: '曲目恢复', sight: '视奏能力', musicality: '音乐性' };
    document.getElementById('summary-time').textContent = tm[state.config.dailyMinutes] || '—';
    document.getElementById('summary-level').textContent = lm[state.config.level] || '—';
    document.getElementById('summary-goals').textContent = state.config.goals.map(g => gm[g]).join('、') || '—';
  }

  // ========== PLAN GENERATION ==========
  function generatePlan() {
    const weeks = [];
    for (let w = 1; w <= 12; w++) {
      weeks.push({
        week: w, title: getWeekTitle(w), description: getWeekDescription(w, state.config.level),
        focus: getWeekFocus(w, state.config.goals),
        dailyStructure: generateDailyStructure(w, state.config.dailyMinutes, state.config.level),
        unlocked: w === 1
      });
    }
    state.plan = weeks; state.currentWeek = 1; state.currentDay = 1; state.logs = {};
    document.getElementById('onboarding').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    save();
    renderToday(); renderPlan(); renderProgress(); renderRepertoire(); updateStreak();
  }
  function getWeekTitle(w) {
    const t = ['唤醒手指','重建连接','找回流动','耐力初建','技巧巩固','速度恢复','精细控制','音乐觉醒','曲目回归','完整演奏','表现力重塑','自由演奏'];
    return t[w - 1] || `第 ${w} 周`;
  }
  function getWeekDescription(w, level) {
    const d = {
      rusty: ['从最基础的音阶和简单曲目开始，让手指重新熟悉键盘','增加手指独立性练习，开始短小的曲目片段','引入琶音和简单和弦，加强左右手协调','逐渐延长单次练习时间，建立耐力基础','加入哈农和车尔尼简单练习曲','开始提速，使用节拍器逐步提升','练习力度层次，恢复动态控制','加入音乐性训练，关注乐句和呼吸','开始恢复以前的保留曲目，从最简单的开始','尝试完整演奏一首中等难度的曲子','细化音色和表情，追求音乐表达','自由选曲，享受演奏的乐趣'],
      dusty: ['快速温习音阶和琶音，找回手指感觉','恢复哈农练习，重建手指独立性','引入练习曲，逐步提升技巧难度','加强节奏训练，恢复稳定的拍感','开始技巧专项训练，针对薄弱环节','提速训练，恢复到以前的演奏速度','精细力度控制，练习 cresc. 和 dim.','音乐性专题，分析乐句结构','回归保留曲目，一周一首','完整背谱演奏，检验恢复成果','表现力深化，形成个人诠释','挑战新曲目，拓展曲目库'],
      fading: ['全面温习，快速找回状态','技巧强化，针对性提升','速度恢复到原有水平','耐力训练，准备长时间演奏','精细控制，追求完美音色','视奏恢复，每天一首新谱','背谱训练，强化记忆','音乐分析，深度理解作品','保留曲目全面恢复','演出模拟，完整流程训练','风格拓展，尝试不同流派','自由演奏，为演出做准备']
    };
    return (d[level] || d.dusty)[w - 1];
  }
  function getWeekFocus(w, goals) {
    const def = ['technique', 'repertoire'];
    const g = goals.length > 0 ? goals : def;
    const rot = [g[0 % g.length], g[1 % g.length], g[0 % g.length], g.length > 2 ? g[2] : g[0]];
    const fm = { technique: '手指机能', repertoire: '曲目恢复', sight: '视奏能力', musicality: '音乐性' };
    return fm[rot[Math.floor((w - 1) / 3) % rot.length]] || '综合训练';
  }
  function generateDailyStructure(week, totalM, level) {
    const r = level === 'rusty' ? 0.7 : level === 'dusty' ? 0.85 : 1.0;
    const wr = week <= 2 ? 0.3 : week <= 4 ? 0.25 : 0.2;
    const tr = week <= 3 ? 0.35 : week <= 6 ? 0.3 : 0.25;
    const rr = week <= 2 ? 0.2 : week <= 4 ? 0.3 : 0.35;
    const fr = 1 - wr - tr - rr;
    return [
      { name: '热身', minutes: Math.round(totalM * wr * r), type: 'warmup' },
      { name: '技巧', minutes: Math.round(totalM * tr * r), type: 'technique' },
      { name: '曲目', minutes: Math.round(totalM * rr * r), type: 'repertoire' },
      { name: '自由', minutes: Math.round(totalM * fr * r), type: 'free' }
    ];
  }

  // ========== ADAPTIVE PLAN ==========
  function getAdaptiveTip() {
    const logs = state.logs;
    const days = Object.keys(logs).sort();
    if (days.length < 3) return null;

    // Get last 7 days of completion rates
    const rates = [];
    for (let i = Math.max(0, days.length - 7); i < days.length; i++) {
      const dk = days[i];
      const log = logs[dk];
      const weekNum = parseInt(dk.match(/w(\d+)d/)?.[1] || 1);
      const dayNum = parseInt(dk.match(/d(\d+)/)?.[1] || 1);
      if (!state.plan || weekNum > state.plan.length) continue;
      const week = state.plan[weekNum - 1];
      const exercises = generateExercises(week, dayNum);
      const total = exercises.length;
      const completed = (log.completed || []).length;
      rates.push(total > 0 ? completed / total : 0);
    }

    if (rates.length < 3) return null;

    // Check last 3 consecutive days
    const last3 = rates.slice(-3);
    const avg3 = last3.reduce((a, b) => a + b, 0) / 3;

    if (avg3 < 0.5) {
      return {
        title: '计划建议：适当降低强度',
        content: '最近 3 天完成率较低（' + Math.round(avg3 * 100) + '%）。建议减少单次练习时间，或把练习拆成早晚各一次。复健是马拉松，不是冲刺。'
      };
    }
    if (avg3 > 0.9) {
      return {
        title: '计划建议：可以尝试提升难度',
        content: '最近 3 天完成率很高（' + Math.round(avg3 * 100) + '%）！你的状态恢复得不错，可以在「设置」中重新生成一个更高强度的计划，或增加每日练习时间。'
      };
    }
    return null;
  }

  function renderAdaptiveTip() {
    const tipEl = document.getElementById('adaptive-tip');
    const tip = getAdaptiveTip();
    if (tip && !state.adaptiveTipDismissed) {
      document.getElementById('adaptive-tip-title').textContent = tip.title;
      document.getElementById('adaptive-tip-content').textContent = tip.content;
      tipEl.classList.remove('hidden');
    } else {
      tipEl.classList.add('hidden');
    }
  }

  function dismissAdaptiveTip() {
    state.adaptiveTipDismissed = true;
    save();
    document.getElementById('adaptive-tip').classList.add('hidden');
  }

  // ========== TODAY TAB ==========
  function renderToday() {
    if (!state.plan) return;
    const week = state.plan[state.currentWeek - 1];
    const dk = `w${state.currentWeek}d${state.currentDay}`;
    const log = state.logs[dk] || { completed: [], totalMinutes: 0 };
    document.getElementById('today-title').textContent = `第 ${state.currentWeek} 周 · 第 ${state.currentDay} 天`;
    const totalMin = week.dailyStructure.reduce((s, e) => s + e.minutes, 0);
    document.getElementById('today-subtitle').textContent = `预计用时 ${totalMin} 分钟 · ${week.title}`;
    const exercises = generateExercises(week, state.currentDay);
    const list = document.getElementById('exercise-list');
    list.innerHTML = '';
    exercises.forEach((ex, i) => {
      const done = log.completed.includes(i);
      const el = document.createElement('div');
      el.className = `card rounded-xl p-4 fade-in-delay-${Math.min(i, 3)} ${done ? 'opacity-60' : ''}`;
      el.innerHTML = `
        <div class="flex items-start gap-3">
          <label class="relative flex items-center mt-0.5 cursor-pointer">
            <input type="checkbox" class="checkbox-custom sr-only" ${done ? 'checked' : ''} onchange="app.toggleExercise(${i})">
            <div class="w-5 h-5 rounded border-2 border-piano-500 flex items-center justify-center transition-colors">
              <svg class="w-3 h-3 text-piano-900 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
            </div>
          </label>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs px-2 py-0.5 rounded-full ${getTypeColor(ex.type)}">${ex.typeLabel}</span>
              <span class="text-sm text-piano-300">${ex.minutes} 分钟</span>
            </div>
            <h4 class="font-semibold text-white text-sm">${ex.name}</h4>
            <p class="text-xs text-piano-400 mt-1">${ex.description}</p>
            ${ex.suggestions ? `<p class="text-xs text-accent/70 mt-1">💡 ${ex.suggestions}</p>` : ''}
          </div>
          <button onclick="app.startTimer('${ex.name.replace(/'/g, "\\'")}', ${ex.minutes})" class="w-9 h-9 rounded-lg bg-piano-700/50 hover:bg-accent/20 flex items-center justify-center transition-colors shrink-0">
            <svg class="w-4 h-4 text-piano-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </button>
        </div>`;
      list.appendChild(el);
    });
    const completed = log.completed.length, total = exercises.length;
    const pct = total > 0 ? (completed / total * 100) : 0;
    document.getElementById('today-progress').style.width = pct + '%';
    document.getElementById('today-progress-text').textContent = `${completed}/${total} 完成`;

    // Adaptive tip
    renderAdaptiveTip();

    if (completed >= total && total > 0) {
      document.getElementById('exercise-list').classList.add('hidden');
      document.getElementById('completion-message').classList.remove('hidden');
      if (!log.celebrated) { log.celebrated = true; state.logs[dk] = log; save(); fireConfetti(); }
    } else {
      document.getElementById('exercise-list').classList.remove('hidden');
      document.getElementById('completion-message').classList.add('hidden');
    }
  }
  function getTypeColor(t) {
    const c = { warmup: 'bg-orange-500/10 text-orange-400', technique: 'bg-blue-500/10 text-blue-400', repertoire: 'bg-purple-500/10 text-purple-400', free: 'bg-green-500/10 text-green-400' };
    return c[t] || 'bg-piano-600 text-piano-300';
  }
  function generateExercises(week, day) {
    const exs = [], tl = { warmup: '热身', technique: '技巧', repertoire: '曲目', free: '自由' }, odd = day % 2 === 1;
    exs.push({ name: odd ? 'C大调音阶 · 慢速' : 'G大调音阶 · 慢速', type: 'warmup', typeLabel: tl.warmup, minutes: Math.max(5, Math.round(week.dailyStructure[0].minutes * 0.4)), description: '分手慢练，注意手指的独立性和连贯性。速度 ♩= 60-72。', suggestions: '想象每个音都"站住"了再弹下一个' });
    exs.push({ name: week.week <= 2 ? '简单琶音 · C大调' : '琶音 · 扩展调性', type: 'warmup', typeLabel: tl.warmup, minutes: Math.max(5, Math.round(week.dailyStructure[0].minutes * 0.35)), description: '跨度练习，注意手腕的放松和转指的自然。', suggestions: '手腕画圈，不要僵硬' });
    if (week.dailyStructure[0].minutes > 10) exs.push({ name: '哈农 No.' + (week.week <= 3 ? '1-5' : week.week <= 6 ? '6-10' : '11-20'), type: 'warmup', typeLabel: tl.warmup, minutes: Math.max(3, Math.round(week.dailyStructure[0].minutes * 0.25)), description: '高抬指慢练，关注每个手指的发力均匀。', suggestions: '可以先弹一遍"贴键"版本，再做高抬指' });
    const tm = week.dailyStructure[1].minutes;
    if (week.week <= 3) exs.push({ name: '手指独立性练习', type: 'technique', typeLabel: tl.technique, minutes: Math.round(tm * 0.5), description: '保留音练习：按住一个音，其他手指做上下动作。', suggestions: '从 1-2 指开始，逐渐扩展到 4-5 指' });
    else exs.push({ name: `车尔尼 Op.${week.week <= 6 ? '599' : '849'} 精选`, type: 'technique', typeLabel: tl.technique, minutes: Math.round(tm * 0.6), description: '选择 2-3 首有针对性的练习曲，分手慢练再合手。', suggestions: '先找难点段落单独练，不要从头到尾一遍遍过' });
    exs.push({ name: week.week <= 4 ? '节奏稳定性训练' : '速度与控制', type: 'technique', typeLabel: tl.technique, minutes: Math.round(tm * 0.4), description: week.week <= 4 ? '使用节拍器，练习各种基本节奏型（附点、切分、三连音）。' : '逐步提速，每次增加 4-8 BPM，保持清晰和均匀。', suggestions: week.week <= 4 ? '可以边弹边数拍子 aloud' : '提速前先确保当前速度完全没有瑕疵' });
    const rm = week.dailyStructure[2].minutes, pc = getRecommendedPiece(week.week, state.config.level);
    exs.push({ name: pc.name, type: 'repertoire', typeLabel: tl.repertoire, minutes: Math.round(rm * 0.7), description: pc.description, suggestions: pc.tip });
    if (rm > 10) exs.push({ name: '旧曲温习', type: 'repertoire', typeLabel: tl.repertoire, minutes: Math.round(rm * 0.3), description: '选一首你曾经弹过的简单曲子，尝试凭记忆演奏。', suggestions: '不要追求完美，先让手指"想起来"' });
    const fm = week.dailyStructure[3].minutes;
    exs.push({ name: '即兴/听音/视奏', type: 'free', typeLabel: tl.free, minutes: fm, description: fm < 8 ? '随心弹：随便弹你喜欢的旋律，不设目标，享受过程。' : '视奏一首全新的简单曲子，或者尝试用耳朵扒一段旋律。', suggestions: fm < 8 ? '这是属于你的时间，想弹什么弹什么' : '视奏时不要停，错了继续往下走' });
    return exs;
  }
  function getRecommendedPiece(w, level) {
    const p = {
      rusty: [
        { name: '巴赫 · 小步舞曲 (BWV Anh. 114)', description: '结构清晰，左右手分工明确，适合重建双手协调。', tip: '先分手把每个声部弹清楚' },
        { name: '贝多芬 · 致爱丽丝', description: '熟悉的旋律， motiv 重复多，容易建立信心。', tip: '注意第 2 段的调性变化' },
        { name: '肖邦 · 降E大调夜曲 Op.9 No.2', description: '右手旋律歌唱性，左手伴奏简单，恢复音乐感觉。', tip: '左手要"隐形"，音量不超过 mf' },
        { name: '德彪西 · 月光', description: '音色控制，踏板运用，重新找回对钢琴的细腻感知。', tip: '踏板要浅，和声变化时及时换' },
      ],
      dusty: [
        { name: '巴赫 · 二部创意曲 No.1', description: '复调思维恢复，声部清晰度训练。', tip: '先分声部练，再二声部合' },
        { name: '莫扎特 · C大调奏鸣曲 K.545 第一乐章', description: '经典回归曲目，技巧全面，音乐性丰富。', tip: '第 2 主题要弹出"歌唱"的感觉' },
        { name: '肖邦 · 圆舞曲 Op.64 No.2', description: '节奏弹性，rubato 的重新掌握。', tip: '左手要像节拍器一样稳定' },
        { name: '拉赫玛尼诺夫 · 前奏曲 Op.3 No.2', description: '和弦与八度，检验恢复成果。', tip: '大和弦先找位置，再一起下' },
      ],
      fading: [
        { name: '巴赫 · 平均律 第一首', description: '全面热身，复调、声部、清晰度一次练到。', tip: '前奏曲和赋格要分开练' },
        { name: '贝多芬 · 悲怆奏鸣曲 第一乐章', description: '技巧与音乐的结合，情感表达恢复。', tip: '引子的和弦要有"命运敲门"的感觉' },
        { name: '李斯特 · 爱之梦 No.3', description: '旋律线条、伴奏织体、踏板的综合训练。', tip: '中段的高潮要层层推进' },
        { name: '肖邦 · 练习曲 Op.10 No.12 (革命)', description: '终极挑战，全面检验复健成果。', tip: '左手的跑动要平均，像"流水"一样' },
      ]
    };
    const list = p[level] || p.dusty;
    return list[(w - 1) % list.length];
  }
  function toggleExercise(i) {
    const dk = `w${state.currentWeek}d${state.currentDay}`;
    if (!state.logs[dk]) state.logs[dk] = { completed: [], totalMinutes: 0 };
    const log = state.logs[dk];
    const idx = log.completed.indexOf(i);
    idx > -1 ? log.completed.splice(idx, 1) : log.completed.push(i);
    state.logs[dk] = log; save();
    renderToday(); renderProgress();
  }
  function resetToday() {
    const dk = `w${state.currentWeek}d${state.currentDay}`;
    state.logs[dk] = { completed: [], totalMinutes: 0 }; save(); renderToday();
  }

  // ========== TIMER ==========
  function startTimer(name, minutes) {
    state.timer.exerciseName = name;
    state.timer.seconds = minutes * 60;
    state.timer.running = false;
    updateTimerDisplay();
    document.getElementById('timer-overlay').classList.remove('hidden');
  }
  function toggleTimer() {
    const t = state.timer;
    if (t.running) { clearInterval(t.interval); t.running = false; document.getElementById('timer-play-btn').textContent = '▶'; document.getElementById('timer-icon').textContent = '▶️'; }
    else {
      t.running = true; document.getElementById('timer-play-btn').textContent = '⏸'; document.getElementById('timer-icon').textContent = '⏸️';
      t.interval = setInterval(() => {
        if (t.seconds > 0) { t.seconds--; t.totalSeconds++; updateTimerDisplay(); }
        else { clearInterval(t.interval); t.running = false; document.getElementById('timer-play-btn').textContent = '▶'; playBeep(); }
      }, 1000);
    }
  }
  function resetTimer() { clearInterval(state.timer.interval); state.timer.running = false; state.timer.seconds = 0; state.timer.totalSeconds = 0; updateTimerDisplay(); document.getElementById('timer-play-btn').textContent = '▶'; }
  function closeTimer() {
    clearInterval(state.timer.interval); state.timer.running = false; document.getElementById('timer-overlay').classList.add('hidden');
    const dk = `w${state.currentWeek}d${state.currentDay}`;
    if (!state.logs[dk]) state.logs[dk] = { completed: [], totalMinutes: 0 };
    state.logs[dk].totalMinutes = (state.logs[dk].totalMinutes || 0) + Math.round(state.timer.totalSeconds / 60);
    state.timer.totalSeconds = 0; save(); renderProgress();
  }
  function updateTimerDisplay() {
    const t = state.timer;
    document.getElementById('timer-display').textContent = `${Math.floor(t.seconds / 60).toString().padStart(2, '0')}:${(t.seconds % 60).toString().padStart(2, '0')}`;
    document.getElementById('timer-exercise-name').textContent = t.exerciseName || '练习';
    document.getElementById('timer-total').textContent = `本次练习 ${Math.floor(t.totalSeconds / 60).toString().padStart(2, '0')}:${(t.totalSeconds % 60).toString().padStart(2, '0')}`;
  }
  function playBeep() { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = 880; gain.gain.value = 0.1; osc.start(); setTimeout(() => osc.stop(), 300); setTimeout(() => { const o2 = ctx.createOscillator(), g2 = ctx.createGain(); o2.connect(g2); g2.connect(ctx.destination); o2.frequency.value = 1100; g2.gain.value = 0.1; o2.start(); setTimeout(() => o2.stop(), 300); }, 350); } catch (e) {} }

  // ========== METRONOME ==========
  function openMetronome() {
    document.getElementById('metronome-modal').classList.remove('hidden');
    renderMetronomeBeats();
  }
  function closeMetronome() {
    stopMetronome();
    document.getElementById('metronome-modal').classList.add('hidden');
  }
  function updateMetronomeBPM(val) {
    state.metronome.bpm = parseInt(val);
    document.getElementById('metronome-bpm-display').textContent = state.metronome.bpm;
    if (state.metronome.running) {
      stopMetronome();
      startMetronome();
    }
  }
  function setMetronomeTimeSig(ts) {
    state.metronome.timeSig = ts;
    document.querySelectorAll('.time-sig-btn').forEach(btn => {
      const active = btn.dataset.ts === ts;
      btn.classList.toggle('bg-accent', active);
      btn.classList.toggle('text-piano-900', active);
      btn.classList.toggle('bg-piano-800', !active);
      btn.classList.toggle('text-piano-300', !active);
    });
    renderMetronomeBeats();
    if (state.metronome.running) {
      stopMetronome();
      startMetronome();
    }
  }
  function renderMetronomeBeats() {
    const container = document.getElementById('metronome-beats');
    const beats = parseInt(state.metronome.timeSig.split('/')[0]);
    container.innerHTML = '';
    for (let i = 0; i < beats; i++) {
      const dot = document.createElement('div');
      dot.className = 'beat-dot w-3 h-3 rounded-full bg-piano-600';
      dot.id = `beat-dot-${i}`;
      container.appendChild(dot);
    }
  }
  function toggleMetronome() {
    if (state.metronome.running) stopMetronome();
    else startMetronome();
  }
  function startMetronome() {
    const m = state.metronome;
    m.running = true;
    m.beat = 0;
    document.getElementById('metronome-toggle-btn').textContent = '⏸';

    // Create audio context if needed
    if (!m.audioCtx) {
      m.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    const beats = parseInt(m.timeSig.split('/')[0]);
    const intervalMs = 60000 / m.bpm;

    function tick() {
      if (!m.running) return;
      playMetronomeClick(m.beat === 0);
      highlightBeat(m.beat, beats);
      m.beat = (m.beat + 1) % beats;
    }

    tick();
    m.interval = setInterval(tick, intervalMs);
  }
  function stopMetronome() {
    const m = state.metronome;
    m.running = false;
    clearInterval(m.interval);
    document.getElementById('metronome-toggle-btn').textContent = '▶';
    document.querySelectorAll('.beat-dot').forEach(d => d.classList.remove('active', 'accent'));
  }
  function playMetronomeClick(isAccent) {
    try {
      const ctx = state.metronome.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = isAccent ? 1000 : 700;
      gain.gain.value = isAccent ? 0.15 : 0.08;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.stop(ctx.currentTime + 0.05);
    } catch (e) {}
  }
  function highlightBeat(beat, total) {
    document.querySelectorAll('.beat-dot').forEach((d, i) => {
      d.classList.remove('active', 'accent');
      if (i === beat) {
        d.classList.add(i === 0 ? 'accent' : 'active');
      }
    });
    const pendulum = document.getElementById('metronome-pendulum');
    pendulum.classList.remove('metronome-beat');
    void pendulum.offsetWidth; // reflow
    pendulum.classList.add('metronome-beat');
  }

  // ========== PLAN TAB ==========
  function renderPlan() {
    if (!state.plan) return;
    const c = document.getElementById('plan-weeks'); c.innerHTML = '';
    state.plan.forEach((week, i) => {
      const isCur = week.week === state.currentWeek, isPast = week.week < state.currentWeek;
      const el = document.createElement('div');
      el.className = `card rounded-xl p-4 ${isCur ? 'ring-1 ring-accent/50' : ''} ${isPast ? 'opacity-60' : ''}`;
      el.innerHTML = `<div class="flex items-start gap-3"><div class="w-10 h-10 rounded-full ${isCur ? 'bg-accent text-piano-900' : isPast ? 'bg-green-500/20 text-green-400' : 'bg-piano-700 text-piano-400'} flex items-center justify-center font-bold text-sm shrink-0">${isPast ? '✓' : week.week}</div><div class="flex-1"><div class="flex items-center gap-2 mb-1"><h3 class="font-semibold text-white">${week.title}</h3>${isCur ? '<span class="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent">进行中</span>' : ''}</div><p class="text-sm text-piano-400 mb-2">${week.description}</p><div class="flex flex-wrap gap-2 text-xs"><span class="px-2 py-1 rounded bg-piano-700/50 text-piano-300">重点: ${week.focus}</span>${week.dailyStructure.map(s => `<span class="px-2 py-1 rounded bg-piano-700/50 text-piano-400">${s.name} ${s.minutes}′</span>`).join('')}</div></div></div>`;
      c.appendChild(el);
    });
  }

  // ========== PROGRESS TAB ==========
  function renderProgress() {
    const logs = state.logs, days = Object.keys(logs);
    const totalDays = days.length;
    const totalMinutes = days.reduce((s, d) => s + (logs[d].totalMinutes || 0), 0);
    document.getElementById('stat-total-days').textContent = totalDays;
    document.getElementById('stat-total-minutes').textContent = totalMinutes;
    document.getElementById('stat-current-streak').textContent = state.streak;
    const totalEx = state.plan ? state.plan.reduce((s, w) => s + w.dailyStructure.length, 0) * 7 : 1;
    const completedEx = days.reduce((s, d) => s + (logs[d].completed || []).length, 0);
    document.getElementById('stat-completion-rate').textContent = Math.round((completedEx / Math.max(totalEx, 1)) * 100) + '%';

    const wd = ['周一','周二','周三','周四','周五','周六','周日'], td = new Date().getDay();
    const chart = document.getElementById('weekly-chart'), labels = document.getElementById('weekly-chart-labels');
    chart.innerHTML = ''; labels.innerHTML = '';
    const maxMin = Math.max(...wd.map((_, i) => { const d = new Date(); d.setDate(d.getDate() - ((td + 6 - i) % 7)); const k = `w${state.currentWeek}d${(d.getDay() || 7)}`; return logs[k]?.totalMinutes || 0; }), 30);
    wd.forEach((name, i) => { const d = new Date(); d.setDate(d.getDate() - ((td + 6 - i) % 7)); const dn = (d.getDay() || 7); const k = `w${state.currentWeek}d${dn}`; const m = logs[k]?.totalMinutes || 0; const h = Math.max((m / maxMin) * 100, 4); const isT = i === 6; const bar = document.createElement('div'); bar.className = `flex-1 rounded-t-md transition-all duration-500 ${isT ? 'bg-accent' : m > 0 ? 'bg-accent/40' : 'bg-piano-700'}`; bar.style.height = h + '%'; chart.appendChild(bar); const lbl = document.createElement('span'); lbl.className = isT ? 'text-accent' : ''; lbl.textContent = name; labels.appendChild(lbl); });
    renderRecoveryCurve();
  }
  function renderRecoveryCurve() {
    const svg = document.getElementById('recovery-curve'), w = 400, h = 150, logs = state.logs;
    const scores = [];
    for (let week = 1; week <= 12; week++) { let ws = 0, dl = 0; for (let day = 1; day <= 7; day++) { const k = `w${week}d${day}`; if (logs[k]) { ws += (logs[k].completed || []).length * 10 + (logs[k].totalMinutes || 0); dl++; } } scores.push(dl > 0 ? ws / dl : (week <= state.currentWeek ? week * 3 : 0)); }
    const maxS = Math.max(...scores, 50);
    const pts = scores.map((s, i) => `${(i / 11) * w},${h - (s / maxS) * (h - 20) - 10}`).join(' ');
    svg.innerHTML = `<defs><linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(201,169,110,0.3)"/><stop offset="100%" stop-color="rgba(201,169,110,0)"/></linearGradient></defs><polygon points="0,${h} ${pts} ${w},${h}" fill="url(#curveGrad)"/><polyline points="${pts}" fill="none" stroke="#c9a96e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${scores.map((s, i) => `<circle cx="${(i / 11) * w}" cy="${h - (s / maxS) * (h - 20) - 10}" r="${i + 1 === state.currentWeek ? 5 : 3}" fill="${i + 1 === state.currentWeek ? '#c9a96e' : '#3a3a44'}" stroke="${i + 1 === state.currentWeek ? '#fff' : 'none'}" stroke-width="1.5"/>`).join('')}`;
  }

  // ========== REPERTOIRE TAB ==========
  const repertoireData = [
    // === 唤醒期 (第1-2周) ===
    {
      name: '哈农钢琴练指法 · No.1-5', composer: 'Hanon', phase: 'awakening', period: '基础练习',
      focus: '高抬指慢练，每个手指独立起落，重建触键感觉',
      difficulty: '入门级', timeEstimate: '10分钟/天',
      pitfall: '不要一开始就用快速度，复健初期宁可慢也要均匀。手指容易僵硬，注意手腕放松。',
      check: '能以 ♩=60 的速度，每个音清晰均匀地弹完，不赶拍、不压手腕',
      tags: ['手指唤醒']
    },
    {
      name: '车尔尼 Op.599 · No.1-10', composer: 'Czerny', phase: 'awakening', period: '基础练习',
      focus: '单手旋律线条，右手跑动的基本连贯性',
      difficulty: '入门级', timeEstimate: '15分钟/天',
      pitfall: '599前面几首看似简单，但容易因为"太简单"而弹得潦草，反而养成坏习惯。',
      check: '旋律线连贯如歌，每个音力度均匀，没有"砸"键或"飘"键',
      tags: ['跑动基础']
    },
    {
      name: '拜厄钢琴基础教程 · No.1-20', composer: 'Beyer', phase: 'awakening', period: '基础练习',
      focus: '双手简单配合，固定五指位置，重建手型框架',
      difficulty: '入门级', timeEstimate: '10分钟/天',
      pitfall: '复健时手型可能塌陷，注意掌关节支撑，手指第一关节不要"折指"。',
      check: '双手能独立弹奏，节奏稳定，手型自然不僵硬',
      tags: ['手型重建']
    },
    {
      name: 'C大调 / G大调 / F大调音阶与琶音', composer: '传统', phase: 'awakening', period: '基础练习',
      focus: '24个大小调中先恢复最常用的三个大调，重建转指记忆',
      difficulty: '入门级', timeEstimate: '8分钟/天',
      pitfall: '拇指从掌下钻过去时容易"抢"或"慢"，注意拇指提前预备位置。',
      check: '分手能以 ♩=80 弹完两个八度，转指处听不出痕迹',
      tags: ['音阶琶音']
    },
    {
      name: '汤普森现代钢琴教程 · 精选曲目', composer: 'Thompson', phase: 'awakening', period: '现代',
      focus: '简单有旋律感的小曲，找回"弹琴"的快乐',
      difficulty: '入门级', timeEstimate: '5分钟/天',
      pitfall: '不要因为是简单小曲就不注意音乐性，这是恢复"歌唱性触键"的好机会。',
      check: '能完整流畅演奏，有基本的句子和呼吸感',
      tags: ['趣味恢复']
    },

    // === 重建期 (第3-4周) ===
    {
      name: '哈农 · No.6-15', composer: 'Hanon', phase: 'rebuilding', period: '基础练习',
      focus: '扩展手指跨度（3-4-5指的独立性），加入变化节奏练习',
      difficulty: '初级', timeEstimate: '10分钟/天',
      pitfall: '4-5指仍然是最弱的，容易"带"旁边的音。注意4-5指的单独高抬。',
      check: '4-5指能清晰独立触键，变化节奏（附点、三连音）弹得均匀',
      tags: ['手指强化']
    },
    {
      name: '车尔尼 Op.599 · No.11-30', composer: 'Czerny', phase: 'rebuilding', period: '基础练习',
      focus: '双手协调、简单和弦、基本节奏型恢复',
      difficulty: '初级', timeEstimate: '15分钟/天',
      pitfall: '599第20首之后开始出现左右手交替跑动，容易顾此失彼。先分手练好再合手。',
      check: '左右手能均匀交替，和弦整齐不"炸"，速度 ♩=88',
      tags: ['双手协调']
    },
    {
      name: '巴赫 · 小步舞曲 (BWV Anh. 114)', composer: 'Bach', phase: 'rebuilding', period: '巴洛克',
      focus: '双手独立，左手的阿尔贝蒂低音要均匀，右手旋律歌唱性',
      difficulty: '初级', timeEstimate: '2周',
      pitfall: '左手容易弹得太重。巴赫的作品没有踏板标记，需要靠手指连奏来连接。',
      check: '能完整背谱演奏，左手伴奏音量不超过右手旋律的 1/3',
      tags: ['复健首选']
    },
    {
      name: '克莱门蒂 · 小奏鸣曲 Op.36 No.1', composer: 'Clementi', phase: 'rebuilding', period: '古典',
      focus: '古典时期奏鸣曲式结构，第一乐章的完整性和音乐走向',
      difficulty: '初级', timeEstimate: '2-3周',
      pitfall: '这个"简单"的奏鸣曲其实藏着古典音乐的核心——平衡、清晰、比例。不要弹得粗糙。',
      check: '三个乐章都能完整演奏，第二乐章要有歌唱性，第三乐章要轻快有弹性',
      tags: ['奏鸣曲入门']
    },
    {
      name: '舒曼 · 童年情景 Op.15 (选曲)', composer: 'Schumann', phase: 'rebuilding', period: '浪漫',
      focus: '浪漫时期的音色想象，"异国和异国的人们"锻炼左手独立性',
      difficulty: '初级', timeEstimate: '1-2周/首',
      pitfall: '舒曼的和声变化丰富，容易忽略声部层次。注意"隐藏的旋律线"。',
      check: '能弹出"说话"般的感觉，有故事性，不只是"弹对音符"',
      tags: ['音色想象']
    },

    // === 巩固期 (第5-6周) ===
    {
      name: '车尔尼 Op.599 · No.31-50', composer: 'Czerny', phase: 'consolidating', period: '基础练习',
      focus: '更复杂的双手配合、三连音、切分节奏、装饰音',
      difficulty: '中级', timeEstimate: '15分钟/天',
      pitfall: '装饰音容易弹得匆忙，要从容地作为旋律的一部分，而不是"赶"过去。',
      check: '装饰音清晰干净，三连音与八分音符对位准确，速度 ♩=96',
      tags: ['技巧恢复']
    },
    {
      name: '车尔尼 Op.599 · No.51-60', composer: 'Czerny', phase: 'consolidating', period: '基础练习',
      focus: '599后期的综合训练，为849做准备',
      difficulty: '中级', timeEstimate: '15分钟/天',
      pitfall: '这几首已经接近中级水平，手指容易疲劳。注意分句和呼吸。',
      check: '能流畅完成，没有"硬弹"的感觉，力度有变化',
      tags: ['599收尾']
    },
    {
      name: '巴赫 · 二部创意曲 No.1 (C大调)', composer: 'Bach', phase: 'consolidating', period: '巴洛克',
      focus: '复调思维的恢复，两条独立旋律线的清晰表达',
      difficulty: '中级', timeEstimate: '2-3周',
      pitfall: '很容易把两个声部弹成"一锅粥"。必须分声部练：先弹高声部并唱低声部，反之亦然。',
      check: '能清楚地听到两个独立旋律，每个声部都有自己的走向和呼吸',
      tags: ['复调核心']
    },
    {
      name: '莫扎特 · C大调奏鸣曲 K.545 第一乐章', composer: 'Mozart', phase: 'consolidating', period: '古典',
      focus: '莫扎特风格的精确、优雅、比例感，这是检验复健成果的标准曲目',
      difficulty: '中级', timeEstimate: '2-3周',
      pitfall: '这首看似简单，但每一个细节都会被放大。不要加太多rubato，莫扎特是"有节制的自由"。',
      check: '第一乐章能完整演奏，左右手对话清晰，发展部有自己的性格变化',
      tags: ['全面检验']
    },
    {
      name: '库劳 · 小奏鸣曲 Op.20 / Op.55', composer: 'Kuhlau', phase: 'consolidating', period: '古典',
      focus: '古典小奏鸣曲的快板乐章，锻炼快速跑动中的清晰度',
      difficulty: '中级', timeEstimate: '1-2周',
      pitfall: '库劳的速度标记通常偏快，复健期可以按标速的 80% 演奏，先求清晰。',
      check: '快板乐章跑动清晰，慢板乐章有歌唱性',
      tags: ['跑动进阶']
    },
    {
      name: '贝多芬 · 致爱丽丝 (WoO 59)', composer: 'Beethoven', phase: 'consolidating', period: '古典',
      focus: '熟悉的旋律找回信心，中段调性变化锻炼和声听觉',
      difficulty: '中级', timeEstimate: '1-2周',
      pitfall: '太熟悉了反而容易弹得俗气。注意贝多芬标志性的"sf"突强，不要弹成渐强。',
      check: '主题温柔内敛，中段有戏剧性对比，再现部有归属感',
      tags: ['耳熟能详']
    },

    // === 进阶期 (第7-8周) ===
    {
      name: '车尔尼 Op.849 · 精选 (No.1-15)', composer: 'Czerny', phase: 'advancing', period: '基础练习',
      focus: '快速跑动的基础——849是连接599和299的桥梁，训练手指的敏捷度',
      difficulty: '中高级', timeEstimate: '20分钟/天',
      pitfall: '849的标速很快（♩=108-120+），复健期先从 ♩=88 开始，逐步提速。',
      check: '跑动均匀有颗粒感，不是"糊"过去的，每次提速4 BPM都能保持质量',
      tags: ['速度恢复']
    },
    {
      name: '巴赫 · 三部创意曲 No.1 (C大调)', composer: 'Bach', phase: 'advancing', period: '巴洛克',
      focus: '三个声部的思维训练，比二部更考验大脑分区能力',
      difficulty: '中高级', timeEstimate: '3-4周',
      pitfall: '三个声部在两只手之间"跳来跳去"，需要先标记每个声部的旋律走向。',
      check: '三个声部独立可辨，中声部不被吃掉，整体有对话感',
      tags: ['复调进阶']
    },
    {
      name: '巴赫 · 法国组曲 (选一首)', composer: 'Bach', phase: 'advancing', period: '巴洛克',
      focus: '舞曲风格——阿勒曼德、库朗特、萨拉班德、吉格，每种有不同的性格和节奏',
      difficulty: '中高级', timeEstimate: '2-3周/组曲',
      pitfall: '每种舞曲都有自己的节奏特征（比如萨拉班德是二拍子的庄重感），不能都弹成一个味道。',
      check: '每种舞曲有明确不同的性格和速度，能听到巴洛克舞蹈的感觉',
      tags: ['风格训练']
    },
    {
      name: '肖邦 · 降E大调夜曲 Op.9 No.2', composer: 'Chopin', phase: 'advancing', period: '浪漫',
      focus: '右手旋律的歌唱性（cantabile），左手分解和弦的"隐形"伴奏',
      difficulty: '中高级', timeEstimate: '2-3周',
      pitfall: '右手旋律容易被伴奏"盖住"。左手必须轻，但轻不是虚，是流动的。踏板是这首的灵魂。',
      check: '右手旋律能独立"唱"出来，有自然的呼吸和rubato，踏板换得干净',
      tags: ['旋律歌唱']
    },
    {
      name: '肖邦 · A小调圆舞曲 (遗作 B.150)', composer: 'Chopin', phase: 'advancing', period: '浪漫',
      focus: '小巧精致的沙龙音乐，锻炼轻巧的触键和优雅的分句',
      difficulty: '中高级', timeEstimate: '1-2周',
      pitfall: '这首短但精，容易弹得粗糙。注意中段对比和结尾的渐慢要自然。',
      check: '轻盈优雅，有华尔兹的"旋转感"，不过分沉重',
      tags: ['轻巧触键']
    },
    {
      name: '德彪西 · 月光 (Clair de Lune)', composer: 'Debussy', phase: 'advancing', period: '印象',
      focus: '音色控制——从ppp到pp的微妙层次，踏板的色彩运用',
      difficulty: '中高级', timeEstimate: '2-3周',
      pitfall: '踏板容易"脏"，和声变化时没有及时换。德彪西的踏板不是连奏工具，是调色板。',
      check: '有"月光"般的朦胧感，层次细腻，高潮处有温暖的音色变化',
      tags: ['音色控制']
    },
    {
      name: '贝多芬 · 悲怆奏鸣曲 Op.13 第二乐章', composer: 'Beethoven', phase: 'advancing', period: '古典',
      focus: '如歌的慢板，检验复健后的音乐表达能力',
      difficulty: '中高级', timeEstimate: '2周',
      pitfall: '这个慢板容易弹得"拖"，贝多芬的慢不是慢动作，是深沉。',
      check: '旋律深沉有力，和声变化有内在的戏剧性，不是"优美"而是"深刻"',
      tags: ['情感深度']
    },

    // === 重塑期 (第9-12周) ===
    {
      name: '车尔尼 Op.299 · 精选 (No.1-10)', composer: 'Czerny', phase: 'reshaping', period: '基础练习',
      focus: '快速跑动的终极训练，手指的独立性和速度的全面恢复',
      difficulty: '高级', timeEstimate: '20分钟/天',
      pitfall: '299对标专业水平，复健期不要强求原速。能以 ♩=108 弹清楚已经很了不起。',
      check: '快速跑动清晰有颗粒感，双手交替天衣无缝',
      tags: ['速度终极']
    },
    {
      name: '巴赫 · 平均律钢琴曲集 · 第一首前奏曲 (C大调)', composer: 'Bach', phase: 'reshaping', period: '巴洛克',
      focus: '所有钢琴音乐的"基石"，分解和弦的极致美感和清晰度',
      difficulty: '高级', timeEstimate: '2-3周',
      pitfall: '这首"简单"的前奏曲其实是对触键控制最严格的考验之一。每个音的力度必须完全一致。',
      check: '像水流一样均匀，没有任何一个音突出或消失，赋格部分声部清晰',
      tags: ['钢琴圣经']
    },
    {
      name: '莫扎特 · A大调奏鸣曲 K.331 第一乐章 (变奏曲)', composer: 'Mozart', phase: 'reshaping', period: '古典',
      focus: '变奏曲式——同一个主题用不同方式演绎，锻炼音乐变化和想象力',
      difficulty: '高级', timeEstimate: '3-4周',
      pitfall: '六个变奏各有性格，容易弹成"同一首歌弹六遍"。每个变奏都是独立的性格肖像。',
      check: '六个变奏各有鲜明的性格对比，主题在每一次变化中都能被"认出"',
      tags: ['变奏曲']
    },
    {
      name: '贝多芬 · 月光奏鸣曲 Op.27 No.2 第一乐章', composer: 'Beethoven', phase: 'reshaping', period: '古典',
      focus: '三连音的永恒流动，踏板与和声的对话，"冥想"般的音乐表达',
      difficulty: '高级', timeEstimate: '2-3周',
      pitfall: '三连音容易越弹越快，必须严格按拍子弹。踏板是和声变化的延伸，不是延长音的工具。',
      check: '三连音像心跳一样稳定持续整首，有神秘的氛围感',
      tags: ['经典回归']
    },
    {
      name: '肖邦 · 降D大调夜曲 Op.27 No.2', composer: 'Chopin', phase: 'reshaping', period: '浪漫',
      focus: '肖邦夜曲的巅峰之作，右手装饰音与左手和声的完美配合',
      difficulty: '高级', timeEstimate: '3-4周',
      pitfall: '装饰音是这首的灵魂，但不能喧宾夺主。中段的高潮要有爆发力但不过火。',
      check: '装饰音如珠落玉盘，中段有戏剧性爆发，再现部如梦幻回忆',
      tags: ['浪漫巅峰']
    },
    {
      name: '肖邦 · 升C小调圆舞曲 Op.64 No.2', composer: 'Chopin', phase: 'reshaping', period: '浪漫',
      focus: '节奏弹性（rubato）的极致，左手稳定如心跳，右手自由如歌',
      difficulty: '高级', timeEstimate: '2-3周',
      pitfall: 'rubato不是"想怎么慢就怎么慢"，是"在稳定的框架内的呼吸"。左手必须像节拍器。',
      check: '左手稳定均匀，右手有自然的rubato但从不"脱轨"，中段有波兰舞曲的豪放',
      tags: ['节奏大师']
    },
    {
      name: '拉赫玛尼诺夫 · G小调前奏曲 Op.23 No.5', composer: 'Rachmaninoff', phase: 'reshaping', period: '浪漫',
      focus: '和弦与八度的爆发力，检验复健后手指的力量恢复',
      difficulty: '高级', timeEstimate: '3-4周',
      pitfall: '大和弦容易"拍"键，要先在空中找好位置再一起下。力量来自手臂重量，不是手指硬压。',
      check: '和弦整齐有力但不"炸"，中段旋律歌唱，再现部有排山倒海的气势',
      tags: ['力量检验']
    },
    {
      name: '李斯特 · 爱之梦 No.3 (S.541)', composer: 'Liszt', phase: 'reshaping', period: '浪漫',
      focus: '旋律、伴奏、和声的三层织体，音色的极致控制',
      difficulty: '高级', timeEstimate: '3-4周',
      pitfall: '这首考验的是"控制"不是"速度"。中段的八度段落需要放松的手臂，不是硬撑。',
      check: '旋律如人声般歌唱，中段层层推进到高潮，结尾如梦境消散',
      tags: ['技巧综合']
    },
    {
      name: '肖邦 · 练习曲 Op.10 No.4 ("激流")', composer: 'Chopin', phase: 'reshaping', period: '浪漫',
      focus: '快速半音阶跑动的终极挑战，右手持续的密集音符',
      difficulty: '演奏级', timeEstimate: '4-6周',
      pitfall: '这是检验复健成果的最终试金石。不要硬练，先用分手慢速把每个指法练对，再逐步提速。',
      check: '右手跑动如流水般均匀清晰，左手和弦不"砸"，整首有紧张激烈的戏剧性',
      tags: ['终极挑战']
    },
  ];
  let currentFilter = 'all';
  function renderRepertoire() {
    const c = document.getElementById('repertoire-list'); c.innerHTML = '';
    const f = currentFilter === 'all' ? repertoireData : repertoireData.filter(p => p.phase === currentFilter);
    f.forEach((piece, i) => {
      const el = document.createElement('div');
      el.className = `card rounded-xl overflow-hidden fade-in-delay-${Math.min(i, 3)}`;
      const phaseColor = {
        awakening: 'text-green-400 border-l-green-500/40',
        rebuilding: 'text-blue-400 border-l-blue-500/40',
        consolidating: 'text-yellow-400 border-l-yellow-500/40',
        advancing: 'text-orange-400 border-l-orange-500/40',
        reshaping: 'text-red-400 border-l-red-500/40'
      }[piece.phase] || 'text-piano-300';
      const phaseLabel = {
        awakening: '🌱 唤醒期', rebuilding: '🔧 重建期', consolidating: '🏗️ 巩固期',
        advancing: '🚀 进阶期', reshaping: '👑 重塑期'
      }[piece.phase] || piece.phase;

      el.innerHTML = `
        <div class="border-l-4 ${phaseColor} p-4">
          <div class="flex items-start justify-between gap-3 mb-2">
            <div class="flex-1 min-w-0">
              <h4 class="font-semibold text-white text-sm mb-1">${piece.name}</h4>
              <div class="flex flex-wrap gap-2 text-xs mb-2">
                <span class="${phaseColor.split(' ')[0]} font-medium">${phaseLabel}</span>
                <span class="text-piano-400">${piece.period}</span>
                <span class="text-piano-500">${piece.difficulty}</span>
                <span class="text-accent/70">⏱ ${piece.timeEstimate}</span>
              </div>
            </div>
          </div>

          <!-- 练习重点 -->
          <div class="bg-piano-800/50 rounded-lg p-3 mb-2">
            <div class="text-xs text-accent font-medium mb-1">🎯 练习重点</div>
            <p class="text-xs text-piano-200">${piece.focus}</p>
          </div>

          <!-- 常见陷阱 + 检验标准 -->
          <div class="grid grid-cols-1 gap-2">
            <div class="bg-red-500/5 border border-red-500/10 rounded-lg p-2.5">
              <div class="text-xs text-red-400/80 font-medium mb-0.5">⚠️ 常见陷阱</div>
              <p class="text-xs text-piano-400">${piece.pitfall}</p>
            </div>
            <div class="bg-green-500/5 border border-green-500/10 rounded-lg p-2.5">
              <div class="text-xs text-green-400/80 font-medium mb-0.5">✓ 检验标准</div>
              <p class="text-xs text-piano-400">${piece.check}</p>
            </div>
          </div>

          <div class="flex flex-wrap gap-1.5 mt-2.5">
            ${piece.tags.map(t => `<span class="px-2 py-0.5 rounded-full bg-piano-700/50 text-piano-300 text-xs">${t}</span>`).join('')}
          </div>
        </div>
      `;
      c.appendChild(el);
    });
  }
  function filterRepertoire(f) {
    currentFilter = f;
    document.querySelectorAll('.rep-filter').forEach(btn => {
      const active = btn.dataset.filter === f;
      btn.classList.toggle('bg-accent', active); btn.classList.toggle('text-piano-900', active);
      btn.classList.toggle('bg-piano-700', !active); btn.classList.toggle('text-piano-300', !active);
    });
    renderRepertoire();
  }

  // ========== RECORDING ==========
  let audioContext = null, analyser = null, dataArray = null, source = null;

  function openRecordModal() {
    document.getElementById('record-modal').classList.remove('hidden');
    document.getElementById('record-piece-name').value = '';
    state.currentMood = 'normal';
    document.querySelectorAll('.mood-btn').forEach(b => { b.classList.toggle('bg-accent', b.dataset.mood === 'normal'); b.classList.toggle('text-piano-900', b.dataset.mood === 'normal'); });
    resetRecordingUI();
  }
  function closeRecordModal() {
    if (state.recording.isRecording) stopRecording();
    document.getElementById('record-modal').classList.add('hidden');
  }
  function setMood(m) {
    state.currentMood = m;
    document.querySelectorAll('.mood-btn').forEach(b => { const active = b.dataset.mood === m; b.classList.toggle('bg-accent', active); b.classList.toggle('text-piano-900', active); b.classList.toggle('bg-piano-800', !active); });
  }
  function resetRecordingUI() {
    state.recording = { isRecording: false, isPaused: false, mediaRecorder: null, audioChunks: [], startTime: 0, pauseTime: 0, stream: null, analyser: null, dataArray: null, animationId: null };
    document.getElementById('record-status-dot').className = 'w-2.5 h-2.5 rounded-full bg-piano-500';
    document.getElementById('record-status-text').textContent = '准备就绪';
    document.getElementById('record-timer').textContent = '00:00';
    document.getElementById('record-btn-icon').className = 'w-6 h-6 rounded-full bg-white';
    document.getElementById('record-stop-btn').disabled = true;
    document.getElementById('record-stop-btn').classList.add('opacity-50', 'cursor-not-allowed');
    clearCanvas(document.getElementById('record-waveform'));
  }
  function clearCanvas(canvas) { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#1e1e22'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

  async function toggleRecording() {
    const rec = state.recording;
    if (!rec.isRecording) { await startRecording(); }
    else if (rec.isPaused) { resumeRecording(); }
    else { pauseRecording(); }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.recording.stream = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      state.recording.mediaRecorder = mediaRecorder;
      state.recording.audioChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) state.recording.audioChunks.push(e.data); };
      mediaRecorder.onstop = () => processRecording();
      mediaRecorder.start(100);

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);

      state.recording.isRecording = true;
      state.recording.isPaused = false;
      state.recording.startTime = Date.now();
      updateRecordingUI(true);
      drawWaveform(document.getElementById('record-waveform'));
    } catch (err) {
      alert('无法访问麦克风，请检查权限设置：' + err.message);
    }
  }

  function pauseRecording() {
    state.recording.mediaRecorder.pause();
    state.recording.isPaused = true;
    state.recording.pauseTime = Date.now();
    updateRecordingUI(false);
    if (state.recording.animationId) cancelAnimationFrame(state.recording.animationId);
  }

  function resumeRecording() {
    state.recording.mediaRecorder.resume();
    state.recording.isPaused = false;
    state.recording.startTime += (Date.now() - state.recording.pauseTime);
    updateRecordingUI(true);
    drawWaveform(document.getElementById('record-waveform'));
  }

  function stopRecording() {
    if (!state.recording.isRecording) return;
    state.recording.mediaRecorder.stop();
    state.recording.stream.getTracks().forEach(t => t.stop());
    if (source) { try { source.disconnect(); } catch (e) {} }
    if (audioContext) { try { audioContext.close(); } catch (e) {} }
    if (state.recording.animationId) cancelAnimationFrame(state.recording.animationId);
    state.recording.isRecording = false;
    state.recording.isPaused = false;
    document.getElementById('record-status-dot').className = 'w-2.5 h-2.5 rounded-full bg-accent';
    document.getElementById('record-status-text').textContent = '处理中...';
  }

  function updateRecordingUI(isRunning) {
    document.getElementById('record-status-dot').className = `w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-red-500 recording-pulse' : 'bg-yellow-500'}`;
    document.getElementById('record-status-text').textContent = isRunning ? '正在录音' : '已暂停';
    document.getElementById('record-btn-icon').className = isRunning ? 'w-4 h-4 bg-white' : 'w-6 h-6 rounded-full bg-white';
    document.getElementById('record-stop-btn').disabled = false;
    document.getElementById('record-stop-btn').classList.remove('opacity-50', 'cursor-not-allowed');
    if (isRunning) updateRecordTimer();
  }

  function updateRecordTimer() {
    if (!state.recording.isRecording || state.recording.isPaused) return;
    const elapsed = Math.floor((Date.now() - state.recording.startTime) / 1000);
    document.getElementById('record-timer').textContent = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
    setTimeout(updateRecordTimer, 1000);
  }

  function drawWaveform(canvas) {
    if (!state.recording.isRecording || state.recording.isPaused) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = 'rgba(30,30,34,0.3)';
    ctx.fillRect(0, 0, w, h);
    analyser.getByteTimeDomainData(dataArray);
    ctx.lineWidth = 2; ctx.strokeStyle = '#c9a96e'; ctx.beginPath();
    const slice = w / dataArray.length;
    for (let i = 0; i < dataArray.length; i++) {
      const v = dataArray[i] / 128.0, y = (v * h) / 2;
      i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * slice, y);
    }
    ctx.stroke();
    state.recording.animationId = requestAnimationFrame(() => drawWaveform(canvas));
  }

  async function processRecording() {
    const blob = new Blob(state.recording.audioChunks, { type: state.recording.mediaRecorder.mimeType });
    const duration = Math.floor((Date.now() - state.recording.startTime) / 1000);
    const pieceName = document.getElementById('record-piece-name').value.trim() || '未命名练习';
    const record = { blob, pieceName, mood: state.currentMood, date: new Date().toISOString(), duration };

    const analysis = await analyzeAudio(blob);
    record.analysis = analysis;

    await saveRecording(record);

    document.getElementById('record-modal').classList.add('hidden');
    resetRecordingUI();

    if (state.plan) {
      renderRecordings();
      if (document.getElementById('tab-record').classList.contains('hidden') === false) {
        generateAIAdvice();
      }
    }
  }

  async function analyzeAudio(blob) {
    try {
      const url = URL.createObjectURL(blob);
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const resp = await fetch(url);
      const arrayBuf = await resp.arrayBuffer();
      const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
      const data = audioBuf.getChannelData(0);
      const sampleRate = audioBuf.sampleRate;

      let sum = 0, max = 0, min = 0;
      for (let i = 0; i < data.length; i++) { const v = data[i]; sum += v * v; max = Math.max(max, v); min = Math.min(min, v); }
      const rms = Math.sqrt(sum / data.length);
      const dynamicRange = max - min;

      const onsets = [];
      const hopSize = Math.floor(sampleRate * 0.01);
      const frameSize = Math.floor(sampleRate * 0.05);
      let lastEnergy = 0;
      for (let i = 0; i < data.length - frameSize; i += hopSize) {
        let energy = 0;
        for (let j = i; j < i + frameSize; j++) energy += data[j] * data[j];
        if (energy > lastEnergy * 1.5 && energy > 0.001) onsets.push(i / sampleRate);
        lastEnergy = energy * 0.9 + lastEnergy * 0.1;
      }

      let bpm = 0, stability = 0;
      if (onsets.length > 3) {
        const intervals = [];
        for (let i = 1; i < onsets.length; i++) intervals.push(onsets[i] - onsets[i - 1]);
        intervals.sort((a, b) => a - b);
        const medianInterval = intervals[Math.floor(intervals.length / 2)];
        bpm = Math.round(60 / medianInterval);
        if (bpm > 200) bpm = Math.round(bpm / 2);
        if (bpm < 40) bpm = Math.round(bpm * 2);
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
        const cv = Math.sqrt(variance) / mean;
        stability = Math.max(0, Math.min(100, Math.round((1 - cv) * 100)));
      }

      const volLevel = Math.round(rms * 1000);
      const volLabel = volLevel < 50 ? '较轻' : volLevel < 150 ? '适中' : '较强';

      audioCtx.close();
      URL.revokeObjectURL(url);

      return { bpm: bpm || '—', dynamicRange: Math.round(dynamicRange * 1000), stability: stability || '—', volumeLevel: volLabel, rms: Math.round(rms * 1000), onsetsCount: onsets.length };
    } catch (e) {
      console.warn('Audio analysis failed:', e);
      return { bpm: '—', dynamicRange: 0, stability: '—', volumeLevel: '—', rms: 0, onsetsCount: 0 };
    }
  }

  async function renderRecordings() {
    const container = document.getElementById('recordings-list');
    const recordings = await getAllRecordings();
    if (recordings.length === 0) {
      container.innerHTML = `<div class="text-center py-12 text-piano-400"><div class="text-4xl mb-3">🎙️</div><p>还没有录音记录</p><p class="text-sm mt-1">点击上方「开始录音」按钮，录制你的第一段练习</p></div>`;
      return;
    }

    recordings.sort((a, b) => new Date(b.date) - new Date(a.date));

    container.innerHTML = '';
    recordings.forEach((rec, i) => {
      const date = new Date(rec.date);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      const durStr = `${Math.floor(rec.duration / 60)}:${(rec.duration % 60).toString().padStart(2, '0')}`;
      const moodEmoji = { good: '😊', normal: '😐', struggle: '😤' }[rec.mood] || '😐';

      const el = document.createElement('div');
      el.className = `card rounded-xl p-4 fade-in-delay-${Math.min(i, 3)}`;
      el.innerHTML = `
        <div class="flex items-center gap-3">
          <button onclick="app.playRecording(${rec.id})" class="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center hover:bg-accent/30 transition-colors shrink-0">
            <svg class="w-5 h-5 text-accent" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="font-semibold text-white text-sm truncate">${rec.pieceName}</h4>
              <span class="text-xs">${moodEmoji}</span>
            </div>
            <div class="flex items-center gap-3 text-xs text-piano-400 mt-0.5">
              <span>${dateStr}</span>
              <span>${durStr}</span>
              ${rec.analysis && rec.analysis.bpm !== '—' ? `<span class="text-accent">♩= ${rec.analysis.bpm}</span>` : ''}
            </div>
          </div>
          <button onclick="app.viewRecordingDetail(${rec.id})" class="px-3 py-1.5 rounded-lg bg-piano-700/50 text-xs text-piano-300 hover:bg-piano-600 transition-colors shrink-0">详情</button>
          <button onclick="app.deleteRecording(${rec.id})" class="w-8 h-8 rounded-lg bg-piano-700/30 flex items-center justify-center text-piano-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      `;
      container.appendChild(el);
    });

    if (recordings.length > 0) {
      generateAIAdvice();
    }
  }

  let currentPlayingAudio = null, currentPlayingId = null;

  async function playRecording(id) {
    if (currentPlayingAudio) { currentPlayingAudio.pause(); currentPlayingAudio = null; }

    const recordings = await getAllRecordings();
    const rec = recordings.find(r => r.id === id);
    if (!rec) return;

    const audio = new Audio(URL.createObjectURL(rec.blob));
    currentPlayingAudio = audio;
    currentPlayingId = id;
    audio.play();
    audio.onended = () => { currentPlayingAudio = null; currentPlayingId = null; };
  }

  async function viewRecordingDetail(id) {
    const recordings = await getAllRecordings();
    const rec = recordings.find(r => r.id === id);
    if (!rec) return;

    const date = new Date(rec.date);
    document.getElementById('detail-title').textContent = '录音详情';
    document.getElementById('detail-piece').textContent = rec.pieceName;
    document.getElementById('detail-date').textContent = `${date.getFullYear()}/${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getDate().toString().padStart(2,'0')} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    document.getElementById('detail-duration').textContent = `${Math.floor(rec.duration / 60)}:${(rec.duration % 60).toString().padStart(2, '0')}`;
    document.getElementById('detail-total-time').textContent = `${Math.floor(rec.duration / 60)}:${(rec.duration % 60).toString().padStart(2, '0')}`;

    const a = rec.analysis || {};
    document.getElementById('detail-bpm').textContent = a.bpm || '—';
    document.getElementById('detail-volume').textContent = a.volumeLevel || '—';
    document.getElementById('detail-stability').textContent = a.stability !== '—' ? `${a.stability}%` : '—';
    document.getElementById('detail-practice').textContent = rec.duration < 60 ? '片段' : rec.duration < 180 ? '练习' : '完整';

    drawStaticWaveform(document.getElementById('detail-waveform'), rec.blob);

    const olderRecs = recordings.filter(r => r.id !== id && new Date(r.date) < new Date(rec.date));
    olderRecs.sort((a, b) => new Date(b.date) - new Date(a.date));
    const prev = olderRecs[0];
    const compDiv = document.getElementById('comparison-content');
    if (prev && prev.analysis && rec.analysis) {
      const bpmDiff = (rec.analysis.bpm !== '—' && prev.analysis.bpm !== '—') ? rec.analysis.bpm - prev.analysis.bpm : null;
      const stabDiff = (rec.analysis.stability !== '—' && prev.analysis.stability !== '—') ? rec.analysis.stability - prev.analysis.stability : null;
      let html = '';
      if (bpmDiff !== null) html += `<p class="${bpmDiff > 0 ? 'text-green-400' : bpmDiff < 0 ? 'text-yellow-400' : 'text-piano-400'}">速度变化：${bpmDiff > 0 ? '↑' : bpmDiff < 0 ? '↓' : '→'} ${Math.abs(bpmDiff)} BPM ${bpmDiff > 0 ? '(提速了)' : bpmDiff < 0 ? '(降速了)' : '(保持稳定)'}</p>`;
      if (stabDiff !== null) html += `<p class="${stabDiff > 0 ? 'text-green-400' : stabDiff < 0 ? 'text-yellow-400' : 'text-piano-400'}">稳定性：${stabDiff > 0 ? '↑' : stabDiff < 0 ? '↓' : '→'} ${Math.abs(stabDiff)}% ${stabDiff > 0 ? '(进步了)' : stabDiff < 0 ? '(略有波动)' : '(保持稳定)'}</p>`;
      if (rec.duration !== prev.duration) html += `<p class="text-piano-300">时长变化：${rec.duration > prev.duration ? '增加了' : '减少了'} ${Math.abs(rec.duration - prev.duration)} 秒</p>`;
      if (!html) html = '<p class="text-piano-400">暂无显著变化，继续练习！</p>';
      compDiv.innerHTML = html;
    } else {
      compDiv.innerHTML = '<p class="text-piano-400">暂无对比数据，多录几次后可以看到进步对比。</p>';
    }

    const advice = generateAdviceForRecording(rec, prev, state.config.level, state.currentWeek);
    document.getElementById('detail-ai-content').innerHTML = advice.map(a => `<p class="flex items-start gap-2"><span class="text-accent mt-0.5">▸</span><span>${a}</span></p>`).join('');

    if (state.detailAudio) { state.detailAudio.pause(); state.detailAudio = null; }
    state.detailAudio = new Audio(URL.createObjectURL(rec.blob));
    state.detailAudio.onended = () => { document.getElementById('detail-play-btn').textContent = '▶'; };
    state.detailAudio.ontimeupdate = () => {
      const pct = state.detailAudio.currentTime / state.detailAudio.duration * 100;
      document.getElementById('detail-progress').style.width = pct + '%';
      document.getElementById('detail-current-time').textContent = `${Math.floor(state.detailAudio.currentTime / 60)}:${Math.floor(state.detailAudio.currentTime % 60).toString().padStart(2, '0')}`;
    };

    document.getElementById('record-detail-modal').classList.remove('hidden');
  }

  function playDetailAudio() {
    if (!state.detailAudio) return;
    if (state.detailAudio.paused) { state.detailAudio.play(); document.getElementById('detail-play-btn').textContent = '⏸'; }
    else { state.detailAudio.pause(); document.getElementById('detail-play-btn').textContent = '▶'; }
  }

  function seekAudio(e) {
    if (!state.detailAudio) return;
    const bar = document.getElementById('detail-progress-bar');
    const rect = bar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    state.detailAudio.currentTime = pct * state.detailAudio.duration;
  }

  function closeDetailModal() {
    if (state.detailAudio) { state.detailAudio.pause(); state.detailAudio = null; }
    document.getElementById('record-detail-modal').classList.add('hidden');
  }

  async function deleteRecording(id) {
    if (!confirm('确定要删除这条录音吗？')) return;
    await deleteRecordingDB(id);
    renderRecordings();
  }

  async function drawStaticWaveform(canvas, blob) {
    try {
      const url = URL.createObjectURL(blob);
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const resp = await fetch(url);
      const buf = await resp.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(buf);
      const data = audioBuf.getChannelData(0);
      const cvs = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      cvs.fillStyle = 'rgba(30,30,34,0.5)';
      cvs.fillRect(0, 0, w, h);
      cvs.fillStyle = 'rgba(201,169,110,0.6)';
      const step = Math.ceil(data.length / w);
      for (let i = 0; i < w; i++) {
        let sum = 0;
        for (let j = i * step; j < (i + 1) * step && j < data.length; j++) sum += Math.abs(data[j]);
        const amp = (sum / step) * h * 2;
        cvs.fillRect(i, (h - amp) / 2, 1, amp);
      }
      ctx.close();
      URL.revokeObjectURL(url);
    } catch (e) { console.warn('Waveform draw failed', e); }
  }

  // ========== AI ADVICE ==========
  function generateAIAdvice() {
    getAllRecordings().then(recordings => {
      if (recordings.length === 0) {
        document.getElementById('ai-advice-card').classList.add('hidden');
        return;
      }
      recordings.sort((a, b) => new Date(b.date) - new Date(a.date));
      const latest = recordings[0];
      const prev = recordings[1];
      const advice = generateAdviceForRecording(latest, prev, state.config.level, state.currentWeek);

      document.getElementById('ai-advice-content').innerHTML = advice.map(a =>
        `<div class="flex items-start gap-2 text-sm text-piano-200"><span class="text-accent mt-0.5 shrink-0">▸</span><span>${a}</span></div>`
      ).join('');
      document.getElementById('ai-advice-date').textContent = new Date(latest.date).toLocaleDateString('zh-CN');
      document.getElementById('ai-advice-card').classList.remove('hidden');
    });
  }

  function generateAdviceForRecording(rec, prev, level, week) {
    const advice = [];
    const a = rec.analysis || {};
    const pa = prev ? prev.analysis : null;

    if (level === 'rusty') {
      advice.push('复健初期，不要急于求成。关注每个音的清晰度和均匀度，速度可以暂时放在第二位。');
      if (a.bpm && a.bpm > 100) advice.push('当前速度偏快，建议将节拍器调慢 20%，确保手指在慢速下能完全控制好再提速。');
    } else if (level === 'dusty') {
      advice.push('你的基础还在，现在的关键是找回"肌肉记忆"。多分手慢练，让手指重新建立和键盘的连接。');
      if (week <= 3) advice.push('前几周重点放在手指独立性和基本技巧恢复上，不要急于挑战高难度段落。');
    } else {
      advice.push('状态恢复得不错，现在可以开始追求音乐的细节了。注意乐句的呼吸和力度的层次感。');
    }

    if (a.bpm !== '—') {
      if (a.bpm < 60) advice.push(`当前速度 ♩= ${a.bpm}，偏慢。如果这是刻意慢练，非常好；如果是无法提速，建议用节拍器从 ♩= ${a.bpm + 4} 开始，每次增加 4 BPM。`);
      else if (a.bpm > 160) advice.push(`当前速度 ♩= ${a.bpm}，非常快。注意不要因为追求速度而牺牲清晰度，快的前提是均匀。`);
      else advice.push(`当前速度 ♩= ${a.bpm}，处于舒适的练习区间。可以尝试在不同速度下演奏，体会速度变化对音乐表达的影响。`);
    }

    if (a.stability !== '—') {
      if (a.stability < 50) advice.push('节奏稳定性有提升空间。建议使用节拍器跟练，先做到外部节奏稳定，再逐步脱离节拍器。');
      else if (a.stability < 75) advice.push('节奏基本稳定，但在某些段落可能有轻微加速或减速。可以尝试录音后自己听一遍，标记出不稳定的地方单独练习。');
      else advice.push('节奏稳定性很好！说明你的内心拍感正在恢复。可以尝试加入一些 rubato，让演奏更有音乐性。');
    }

    if (a.volumeLevel === '较轻') advice.push('整体音量偏轻。检查一下是否触键太浅，试着让手指"沉入"琴键，增加下键深度来获得更饱满的音色。');
    else if (a.volumeLevel === '较强') advice.push('整体音量偏强。注意钢琴的动态范围很大，强要有爆发力，弱要能做到 pp。试着在一句内做出明显的强弱变化。');

    if (pa && a.bpm !== '—' && pa.bpm !== '—') {
      const diff = a.bpm - pa.bpm;
      if (diff > 10) advice.push(`比上次录音快了 ${diff} BPM！提速的同时要注意质量，宁可慢一点也要均匀清晰。`);
      else if (diff < -10) advice.push(`比上次录音慢了 ${Math.abs(diff)} BPM。如果是刻意慢练，这是很好的练习方法；如果不是，检查一下是否有技术难点需要单独攻克。`);
    }

    if (rec.duration < 30) advice.push('录音时长较短。钢琴练习需要持续的注意力，建议每次至少完整练习一个乐段，不要只录几秒。');
    else if (rec.duration > 300) advice.push('录音时长很长。长时间练习很好，但也要注意效率。建议每 25 分钟休息一次，让手指和大脑都放松一下。');

    if (rec.mood === 'struggle') advice.push('感到困难是正常的，复健的路上一定会有瓶颈期。把难点拆成更小的段落，一个音一个音地攻克，不要整段一遍遍过。');
    else if (rec.mood === 'good') advice.push('状态很好！趁着手感热，可以多录几遍，选最好的一版保存下来作为里程碑。');

    const weekAdvice = [
      '第 1 周：重点是让手指重新"认识"键盘。不要追求速度，每个音都要"站住"。',
      '第 2 周：继续巩固基础，哈农和音阶每天坚持。手指正在重新建立连接。',
      '第 3 周：可以尝试加入一些简单的曲目片段，检验基础恢复情况。',
      '第 4 周：耐力开始恢复，尝试延长单次练习时间，但不要过度疲劳。',
      '第 5 周：技巧专项训练，针对自己的薄弱环节加大练习量。',
      '第 6 周：速度恢复的关键期，使用节拍器逐步提速，每次增加 4-8 BPM。',
      '第 7 周：关注力度层次，练习 crescendo 和 diminuendo，让音乐有起伏。',
      '第 8 周：音乐性训练，分析乐句结构，注意呼吸和分句。',
      '第 9 周：开始回归保留曲目，从最简单的开始，一周一首。',
      '第 10 周：完整演奏训练，尝试背谱，模拟演出状态。',
      '第 11 周：表现力深化，形成个人诠释，注意音色变化。',
      '第 12 周：自由演奏，享受音乐。可以挑战一些新的曲目了！'
    ];
    if (week >= 1 && week <= 12) advice.push(weekAdvice[week - 1]);

    return advice;
  }

  // ========== JOURNAL ==========
  function setJournalMood(mood) {
    state.journalMood = mood;
    document.querySelectorAll('.journal-mood-btn').forEach(btn => {
      const active = btn.dataset.mood === mood;
      btn.classList.toggle('bg-accent', active);
      btn.classList.toggle('text-piano-900', active);
      btn.classList.toggle('bg-piano-800', !active);
    });
  }

  function saveJournalEntry() {
    const text = document.getElementById('journal-text').value.trim();
    if (!text) {
      alert('请写点什么再保存吧～');
      return;
    }
    const entry = {
      id: Date.now(),
      text,
      mood: state.journalMood,
      date: new Date().toISOString(),
      week: state.currentWeek,
      day: state.currentDay
    };
    state.journal.unshift(entry);
    save();
    document.getElementById('journal-text').value = '';
    renderJournal();
  }

  function deleteJournalEntry(id) {
    if (!confirm('确定要删除这条日志吗？')) return;
    state.journal = state.journal.filter(e => e.id !== id);
    save();
    renderJournal();
  }

  function renderJournal() {
    const container = document.getElementById('journal-list');
    if (state.journal.length === 0) {
      container.innerHTML = `<div class="text-center py-12 text-piano-400 fade-in"><div class="text-4xl mb-3">📝</div><p>还没有练习日志</p><p class="text-sm mt-1">记录每次练琴的感受，追踪你的心路历程</p></div>`;
      return;
    }

    container.innerHTML = '';
    const moodMap = {
      great: { emoji: '😄', label: '超棒' },
      good: { emoji: '🙂', label: '不错' },
      normal: { emoji: '😐', label: '一般' },
      tired: { emoji: '😫', label: '疲惫' },
      frustrated: { emoji: '😤', label: '受挫' }
    };

    state.journal.forEach((entry, i) => {
      const date = new Date(entry.date);
      const dateStr = `${date.getFullYear()}/${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getDate().toString().padStart(2,'0')}`;
      const mood = moodMap[entry.mood] || moodMap.normal;

      const el = document.createElement('div');
      el.className = `card rounded-xl p-4 fade-in-delay-${Math.min(i, 3)}`;
      el.innerHTML = `
        <div class="flex items-start gap-3">
          <div class="text-xl shrink-0">${mood.emoji}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs text-piano-400">${dateStr}</span>
              <span class="text-xs px-2 py-0.5 rounded-full bg-piano-700/50 text-piano-300">第 ${entry.week} 周 · 第 ${entry.day} 天</span>
              <span class="text-xs text-accent">${mood.label}</span>
            </div>
            <p class="text-sm text-piano-200 whitespace-pre-wrap">${escapeHtml(entry.text)}</p>
          </div>
          <button onclick="app.deleteJournalEntry(${entry.id})" class="w-7 h-7 rounded-lg bg-piano-700/30 flex items-center justify-center text-piano-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      `;
      container.appendChild(el);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ========== TABS ==========
  function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById('tab-' + tab).classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('tab-active', active);
      btn.classList.toggle('text-piano-400', !active);
    });
    if (tab === 'progress') renderProgress();
    if (tab === 'plan') renderPlan();
    if (tab === 'repertoire') renderRepertoire();
    if (tab === 'record') renderRecordings();
    if (tab === 'journal') renderJournal();
  }

  // ========== STREAK ==========
  function updateStreak() {
    document.getElementById('streak-display').textContent = `连续 ${state.streak} 天`;
    document.getElementById('current-week').textContent = state.currentWeek;
    document.getElementById('current-day').textContent = state.currentDay;
  }

  // ========== CONFETTI ==========
  function fireConfetti() {
    const colors = ['#c9a96e', '#e0c080', '#a8844a', '#fff', '#f0e6d3'];
    for (let i = 0; i < 60; i++) {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.top = '-10px';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
      el.style.width = (4 + Math.random() * 6) + 'px';
      el.style.height = (4 + Math.random() * 6) + 'px';
      document.body.appendChild(el);
      const dur = 2000 + Math.random() * 3000;
      const xm = (Math.random() - 0.5) * 300;
      el.animate([{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: `translate(${xm}px, 100vh) rotate(${Math.random()*720}deg)`, opacity: 0 }], { duration: dur, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' });
      setTimeout(() => el.remove(), dur);
    }
  }

  // ========== SETTINGS ==========
  function showSettings() {
    if (confirm('⚙️ 设置\n\n要重置所有数据并重新开始吗？')) {
      localStorage.removeItem('pianoRehab');
      indexedDB.deleteDatabase(DB_NAME);
      location.reload();
    }
  }

  // ========== INIT ==========
  async function init() {
    try {
      registerServiceWorker();
      await initDB();
      if (state.plan) {
        document.getElementById('onboarding').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        renderToday(); renderPlan(); renderProgress(); renderRepertoire(); updateStreak();
      } else {
        // Restore onboarding to saved step, or default to welcome
        const validSteps = ['welcome', 'time', 'level', 'goals', 'generate'];
        const stepToShow = validSteps.includes(state.step) ? state.step : 'welcome';
        showStep(stepToShow);
        if (stepToShow === 'generate') updateSummary();
      }
    } catch (e) {
      console.error('init error:', e);
      // Fallback: show welcome step if anything fails
      const welcome = document.getElementById('step-welcome');
      if (welcome) welcome.classList.remove('hidden');
    }
  }

  init();

  return {
    nextStep, prevStep, setTime, setLevel, toggleGoal, generatePlan,
    switchTab, toggleExercise, resetToday,
    startTimer, toggleTimer, resetTimer, closeTimer,
    filterRepertoire, showSettings,
    openRecordModal, closeRecordModal, toggleRecording, stopRecording, setMood,
    playRecording, viewRecordingDetail, playDetailAudio, seekAudio, closeDetailModal, deleteRecording,
    // Tier 1 exports
    openMetronome, closeMetronome, toggleMetronome, updateMetronomeBPM, setMetronomeTimeSig,
    setJournalMood, saveJournalEntry, deleteJournalEntry,
    dismissAdaptiveTip
  };
})();
