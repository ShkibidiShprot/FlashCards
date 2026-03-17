"use strict";

const FALLBACK_TOPICS = [{"id": 1, "name": "Вступ до історії України"}];
const FALLBACK_CARDS = [{"type": "date", "topicId": 1, "question": "Немає підключення", "answer": "Запустіть через локальний сервер"}];

const hashString = str => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
    return Math.abs(hash).toString(36);
};

class SpacedRepetition {
    constructor() {
        this.cards = [];
        this.topics = [];
        this.sessionQueue = [];
        this.currentCard = null;
        this.currentOptions = [];
        this.sessionSize = 20;
        this.isFlipped = false;
        this.testAnswered = false;
    }

    async init() {
        try {
            const fetches = ['materials/data.json', 'materials/dates.json', 'materials/persons.json', 'materials/terms.json', 'materials/topics.json'].map(url => 
                fetch(url).then(res => res.ok ? res.json() : []).catch(() => [])
            );
            
            const [data, dates, persons, terms, topics] = await Promise.all(fetches);
            const rawCards = [...data, ...dates, ...persons, ...terms];
            
            this.cards = rawCards.map(c => ({
                ...c,
                id: c.id || hashString(`${c.topicId}${c.type}${c.question}`)
            }));
            
            this.topics = topics;
            if (!this.topics.length || !this.cards.length) throw new Error();
        } catch {
            this.cards = FALLBACK_CARDS.map(c => ({ ...c, id: hashString(c.question) }));
            this.topics = FALLBACK_TOPICS;
        }
        this.loadProgress();
    }

    loadProgress() {
        const saved = localStorage.getItem('flashcardProgress');
        const progress = saved ? JSON.parse(saved) : {};
        this.cards = this.cards.map(card => ({
            ...card,
            level: progress[card.id]?.level || 0,
            lastReviewed: progress[card.id]?.lastReviewed || null
        }));
    }

    saveProgress() {
        const progress = this.cards.reduce((acc, card) => {
            if (card.level > 0 || card.lastReviewed) {
                acc[card.id] = { level: card.level, lastReviewed: card.lastReviewed };
            }
            return acc;
        }, {});
        localStorage.setItem('flashcardProgress', JSON.stringify(progress));
    }

    resetProgress() {
        localStorage.removeItem('flashcardProgress');
        this.loadProgress();
    }

    getFilteredCards(topicFilter, typeFilter, importanceFilter) {
        return this.cards.filter(card => {
            const topicMatch = topicFilter === 'all' || card.topicId === parseInt(topicFilter, 10);
            const typeMatch = typeFilter === 'all' || card.type === typeFilter;
            const importanceMatch = importanceFilter === 'all' || !card.optional;
            return topicMatch && typeMatch && importanceMatch;
        });
    }

    buildSessionQueue(topicFilter, typeFilter, importanceFilter) {
        const filtered = this.getFilteredCards(topicFilter, typeFilter, importanceFilter);
        const byLevel = { 0: [], 1: [], 2: [], 3: [] };
        
        filtered.forEach(card => byLevel[card.level].push(card));
        Object.values(byLevel).forEach(arr => this.shuffle(arr));

        const queue = [];
        const maxCards = Math.min(this.sessionSize, filtered.length);
        const distribution = { 0: 0.5, 1: 0.3, 2: 0.15, 3: 0.05 };

        while (queue.length < maxCards) {
            let added = false;
            for (let level = 0; level <= 3; level++) {
                const target = Math.ceil(maxCards * distribution[level]);
                const available = byLevel[level].filter(c => !queue.includes(c));
                const take = Math.min(target, available.length, maxCards - queue.length);
                if (take > 0) {
                    queue.push(...available.slice(0, take));
                    added = true;
                }
                if (queue.length >= maxCards) break;
            }
            if (!added && queue.length < maxCards) {
                const remaining = filtered.filter(c => !queue.includes(c));
                queue.push(...remaining.slice(0, maxCards - queue.length));
                break;
            }
        }
        
        this.sessionQueue = this.shuffle(queue);
        return this.sessionQueue.length;
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    getOptionsForCard(card) {
        let pool = this.cards.filter(c => c.type === card.type && c.id !== card.id && Math.abs((c.topicId || 0) - (card.topicId || 0)) <= 1);
        let unique = [...new Set(pool.map(c => c.answer))];

        if (unique.length < 3) {
            pool = this.cards.filter(c => c.type === card.type && c.id !== card.id);
            unique = [...new Set(pool.map(c => c.answer))];
        }

        if (unique.length < 3) {
            pool = this.cards.filter(c => c.id !== card.id);
            unique = [...new Set(pool.map(c => c.answer))];
        }

        this.shuffle(unique);
        const options = [card.answer, ...unique.slice(0, 3)];
        return this.shuffle(options);
    }

    getNextCard() {
        this.currentCard = this.sessionQueue.shift() || null;
        this.isFlipped = false;
        this.testAnswered = false;
        return this.currentCard;
    }

    flipCard() {
        if (this.currentCard) this.isFlipped = !this.isFlipped;
        return this.isFlipped;
    }

    rateCard(rating) {
        if (!this.currentCard) return;
        const card = this.cards.find(c => c.id === this.currentCard.id);
        if (!card) return;

        switch(rating) {
            case 'again':
                card.level = 0;
                this.sessionQueue.splice(Math.min(3, this.sessionQueue.length), 0, card);
                break;
            case 'hard':
                card.level = Math.max(0, card.level);
                break;
            case 'good':
                card.level = Math.min(3, card.level + 1);
                break;
            case 'easy':
                card.level = 3;
                break;
        }
        card.lastReviewed = Date.now();
        this.saveProgress();
    }

    getStats(topicFilter, typeFilter, importanceFilter) {
        const filtered = this.getFilteredCards(topicFilter, typeFilter, importanceFilter);
        return {
            total: filtered.length,
            new: filtered.filter(c => c.level === 0).length,
            learning: filtered.filter(c => c.level === 1).length,
            remembered: filtered.filter(c => c.level === 2).length,
            mastered: filtered.filter(c => c.level === 3).length
        };
    }
}

const sr = new SpacedRepetition();
const state = { active: false, reviewed: 0, total: 0, isTransitioning: false };
const $ = id => document.getElementById(id);

const els = {
    topic: $('topicFilter'), type: $('typeFilter'), importance: $('importanceFilter'), mode: $('modeFilter'),
    start: $('startBtn'), reset: $('resetBtn'), stats: $('stats'), container: $('cardContainer'), card: $('card'),
    typeFront: $('cardType'), typeBack: $('cardTypeBack'), badgeFront: $('cardBadge'), badgeBack: $('cardBadgeBack'),
    question: $('cardQuestion'), answer: $('cardAnswer'), rating: $('ratingButtons'), options: $('cardOptions'),
    hint: $('cardHint'), kbdHints: $('kbdHints'), empty: $('emptyState'), progress: $('progressBar'), fill: $('progressFill'),
    sTotal: $('statTotal'), sNew: $('statNew'), sLearn: $('statLearning'), sMaster: $('statMastered')
};

async function init() {
    await sr.init();
    sr.topics.forEach(t => els.topic.insertAdjacentHTML('beforeend', `<option value="${t.id}">${t.id}. ${t.name}</option>`));
    updateStats();
}

function updateStats() {
    const s = sr.getStats(els.topic.value, els.type.value, els.importance.value);
    els.sTotal.textContent = s.total;
    els.sNew.textContent = s.new;
    els.sLearn.textContent = s.learning;
    els.sMaster.textContent = s.mastered;
}

function getTypeName(type) {
    return type === 'date' ? 'Дата' : type === 'term' ? 'Термін' : 'Постать';
}

function updateCardContent(card) {
    const typeName = getTypeName(card.type);
    const typeClass = `card-type type-${card.type}`;
    const isReverse = els.mode.value === 'reverse';
    const isTest = els.mode.value === 'test';
    const isOptional = !!card.optional;
    
    els.typeFront.textContent = typeName;
    els.typeBack.textContent = typeName;
    els.typeFront.className = typeClass;
    els.typeBack.className = typeClass;
    
    els.badgeFront.style.display = isOptional ? 'block' : 'none';
    els.badgeBack.style.display = isOptional ? 'block' : 'none';
    
    els.question.textContent = isReverse && !isTest ? card.answer : card.question;
    els.answer.textContent = isReverse && !isTest ? card.question : card.answer;

    if (isTest) {
        els.hint.style.display = 'none';
        els.options.style.display = 'flex';
        const opts = sr.getOptionsForCard(card);
        els.options.innerHTML = opts.map((opt, i) => 
            `<button class="option-btn" data-index="${i}">${i + 1}. ${opt}</button>`
        ).join('');
        sr.currentOptions = opts;
        els.kbdHints.innerHTML = '<p><kbd>1</kbd>-<kbd>4</kbd> вибрати &nbsp; <kbd>Esc</kbd> завершити</p>';
    } else {
        els.hint.style.display = 'block';
        els.options.style.display = 'none';
        els.kbdHints.innerHTML = '<p><kbd>Space</kbd> перевернути &nbsp; <kbd>1</kbd>-<kbd>4</kbd> оцінити &nbsp; <kbd>Esc</kbd> завершити</p>';
    }
}

function displayCard(card) {
    if (!card) return endSession();
    updateCardContent(card);
    els.card.classList.remove('flipped');
    els.rating.classList.remove('visible');
    updateProgress();
}

function updateProgress() {
    const totalItems = state.reviewed + sr.sessionQueue.length + (sr.currentCard ? 1 : 0);
    const progress = totalItems > 0 ? (state.reviewed / totalItems) * 100 : 0;
    els.fill.style.width = `${progress}%`;
}

function startSession() {
    state.total = sr.buildSessionQueue(els.topic.value, els.type.value, els.importance.value);
    if (state.total === 0) {
        els.empty.innerHTML = '<p>Немає карток за цими фільтрами.</p>';
        return;
    }
    
    state.reviewed = 0;
    state.active = true;
    state.isTransitioning = false;
    
    els.empty.style.display = 'none';
    els.stats.style.display = 'flex';
    els.container.style.display = 'block';
    els.progress.style.display = 'block';
    els.start.textContent = 'Завершити сесію';
    
    els.container.classList.add('switching');
    updateStats();
    
    const nextCard = sr.getNextCard();
    updateCardContent(nextCard);
    
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            els.container.classList.remove('switching');
        });
    });
}

function endSession() {
    state.active = false;
    state.isTransitioning = false;
    els.empty.style.display = 'block';
    els.empty.innerHTML = `<p>Сесію завершено! Ви повторили ${state.reviewed} карток.</p>`;
    els.stats.style.display = 'none';
    els.container.style.display = 'none';
    els.progress.style.display = 'none';
    els.rating.classList.remove('visible');
    els.container.classList.remove('switching');
    els.card.classList.remove('no-transition');
    els.start.textContent = 'Почати сесію';
    updateStats();
}

function flipCard() {
    if (!state.active || !sr.currentCard || state.isTransitioning || els.mode.value === 'test') return;
    const flipped = sr.flipCard();
    els.card.classList.toggle('flipped', flipped);
    els.rating.classList.toggle('visible', flipped);
}

function handleOptionSelect(index) {
    if (!state.active || state.isTransitioning || sr.testAnswered) return;
    sr.testAnswered = true;
    
    const isCorrect = sr.currentOptions[index] === sr.currentCard.answer;
    const buttons = els.options.querySelectorAll('.option-btn');
    
    buttons.forEach((btn, i) => {
        btn.disabled = true;
        if (sr.currentOptions[i] === sr.currentCard.answer) {
            btn.classList.add('correct');
        } else if (i === index && !isCorrect) {
            btn.classList.add('wrong');
        }
    });
    
    setTimeout(() => rateCard(isCorrect ? 'good' : 'again'), 1200);
}

async function rateCard(rating) {
    if (!state.active || state.isTransitioning) return;
    if (els.mode.value !== 'test' && !sr.isFlipped) return;
    
    state.isTransitioning = true;
    
    sr.rateCard(rating);
    state.reviewed++;
    updateStats();
    
    els.container.classList.add('switching');
    els.rating.classList.remove('visible');
    
    await new Promise(r => setTimeout(r, 200));
    
    els.card.classList.add('no-transition');
    els.card.classList.remove('flipped');
    
    const nextCard = sr.getNextCard();
    if (!nextCard) {
        endSession();
        return;
    }
    
    updateCardContent(nextCard);
    updateProgress();
    
    void els.card.offsetWidth;
    
    els.card.classList.remove('no-transition');
    els.container.classList.remove('switching');
    
    await new Promise(r => setTimeout(r, 300));
    state.isTransitioning = false;
}

els.start.addEventListener('click', () => state.active ? endSession() : startSession());
els.reset.addEventListener('click', () => {
    if (confirm('Скинути весь прогрес? Це неможливо скасувати.')) {
        sr.resetProgress();
        updateStats();
        if (state.active) endSession();
    }
});

els.card.addEventListener('click', flipCard);
els.options.addEventListener('click', e => {
    e.stopPropagation();
    const btn = e.target.closest('.option-btn');
    if (btn) handleOptionSelect(parseInt(btn.dataset.index, 10));
});

els.topic.addEventListener('change', updateStats);
els.type.addEventListener('change', updateStats);
els.importance.addEventListener('change', updateStats);
els.mode.addEventListener('change', () => {
    if (state.active && sr.currentCard) updateCardContent(sr.currentCard);
});

document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', e => {
        e.stopPropagation();
        rateCard(btn.dataset.rating);
    });
});

document.addEventListener('keydown', e => {
    if (!state.active || state.isTransitioning || e.ctrlKey || e.altKey || e.metaKey) return;
    
    if (e.key === 'Escape') return endSession();
    
    if (els.mode.value === 'test') {
        if (['1', '2', '3', '4'].includes(e.key) && !sr.testAnswered) {
            handleOptionSelect(parseInt(e.key, 10) - 1);
        }
    } else {
        const keyMap = { ' ': () => flipCard(), '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
        if (e.key === ' ') {
            e.preventDefault();
            flipCard();
        } else if (keyMap[e.key] && sr.isFlipped) {
            rateCard(keyMap[e.key]);
        }
    }
});

init();