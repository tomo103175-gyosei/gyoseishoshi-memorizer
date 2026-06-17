/* ==========================================================================
   FRONTEND LOGIC: ADMIN SCRIVENER LAW STUDY APP (app.js)
   Text-to-Speech Engine, UI Navigation, Active Sentence Highlighting
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // --- Application State ---
    let currentLawName = "";
    let lawData = null;
    let activeArticleIndex = -1;
    let activeSentenceIndex = -1;
    let sentences = []; // Sentence chunks for TTS [{ index, text, isHeader, isIndent }]

    // Playback States
    let isPlaying = false;
    let isPaused = false;
    let autoplayEnabled = true;
    let focusModeEnabled = false;
    let wakeLockEnabled = true;
    let wakeLock = null;
    let speechRate = 1.0;
    
    // Favorites State
    let favoritesOnly = false;
    let bookmarks = {};
    try {
        bookmarks = JSON.parse(localStorage.getItem('gyosei_bookmarks')) || {};
    } catch(e) { bookmarks = {}; }

    function saveBookmarks() {
        localStorage.setItem('gyosei_bookmarks', JSON.stringify(bookmarks));
    }
    
    // UI Layout Configuration
    let fontSize = "medium"; // small, medium, large, xlarge

    // Speech Engine Instance
    let currentUtterance = null;

    // TTS Audio Players (Two-player ping-pong to bypass Web Speech API & background restrictions natively)
    const audioPlayers = [new Audio(), new Audio()];
    let currentPlayerIndex = 0;
    let hasTransitioned = false;

    // Keep-alive audio to prevent background JS suspension on mobile
    const keepAliveAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    keepAliveAudio.loop = true;

    // Watchdog to detect infinite buffering stalls
    let watchdogTimer = null;

    function resetWatchdog() {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        watchdogTimer = setTimeout(() => {
            if (isPlaying && !isPaused && !hasTransitioned) {
                console.warn("Watchdog timeout! Audio seems stuck, skipping to next.");
                hasTransitioned = true;
                playNextTrack();
            }
        }, 15000);
    }

    function clearWatchdog() {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        watchdogTimer = null;
    }

    function getCurrentPlayer() { return audioPlayers[currentPlayerIndex]; }
    function getNextPlayer() { return audioPlayers[1 - currentPlayerIndex]; }

    // --- DOM Elements ---
    const screens = {
        top: document.getElementById('screen-top'),
        selector: document.getElementById('screen-selector'),
        learning: document.getElementById('screen-learning')
    };

    const statusPill = document.getElementById('active-status');
    const statusText = document.getElementById('status-text');
    const lawLoading = document.getElementById('law-loading');
    const selectorControls = document.getElementById('selector-controls');
    const lawStructureContainer = document.getElementById('law-structure-container');
    const inputSearch = document.getElementById('input-article-search');
    const btnClearSearch = document.getElementById('btn-clear-search');

    // Labels
    const lblActiveLaw = document.getElementById('label-active-law');
    const lblLearningLaw = document.getElementById('label-learning-law');
    const lblLearningChapter = document.getElementById('label-learning-chapter');
    const lblLearningTitle = document.getElementById('label-learning-title');

    // Article Content Area
    const readingViewport = document.getElementById('reading-viewport');
    const articleViewContent = document.getElementById('article-view-content');

    // Controls
    const btnPlay = document.getElementById('btn-audio-play');
    const btnStop = document.getElementById('btn-audio-stop');
    const playSvg = document.getElementById('play-svg');
    const pauseSvg = document.getElementById('pause-svg');
    const playBtnText = document.getElementById('play-btn-text');
    const sliderSpeed = document.getElementById('slider-speed');
    const lblSpeedValue = document.getElementById('label-speed-value');
    
    const switchAutoplay = document.getElementById('switch-autoplay');
    const switchFocus = document.getElementById('switch-focus');
    const switchWakelock = document.getElementById('switch-wakelock');
    const switchFavoritesOnly = document.getElementById('switch-favorites-only');
    const btnFavoriteArticle = document.getElementById('btn-favorite-article');

    // Swipe buttons
    const btnPrevArticle = document.getElementById('btn-prev-article');
    const btnNextArticle = document.getElementById('btn-next-article');

    // Font size display
    const btnFontDec = document.getElementById('btn-font-dec');
    const btnFontInc = document.getElementById('btn-font-inc');
    const fontDisplay = document.getElementById('font-size-display');

    // --- Font Size Manager ---
    const fontSizeMap = {
        'small': { class: 'font-size-small', display: '小' },
        'medium': { class: 'font-size-medium', display: '中' },
        'large': { class: 'font-size-large', display: '大' },
        'xlarge': { class: 'font-size-xlarge', display: '特大' }
    };
    const fontSizeKeys = Object.keys(fontSizeMap);

    function updateFontSize(newSize) {
        fontSize = newSize;
        // Reset classes
        fontSizeKeys.forEach(k => readingViewport.classList.remove(fontSizeMap[k].class));
        // Add active
        readingViewport.classList.add(fontSizeMap[fontSize].class);
        readingViewport.setAttribute('data-font-size', fontSize);
        fontDisplay.textContent = fontSizeMap[fontSize].display;
    }

    btnFontInc.addEventListener('click', () => {
        const currIdx = fontSizeKeys.indexOf(fontSize);
        if (currIdx < fontSizeKeys.length - 1) {
            updateFontSize(fontSizeKeys[currIdx + 1]);
        }
    });

    btnFontDec.addEventListener('click', () => {
        const currIdx = fontSizeKeys.indexOf(fontSize);
        if (currIdx > 0) {
            updateFontSize(fontSizeKeys[currIdx - 1]);
        }
    });

    // --- Navigation Controllers ---
    function showScreen(screenKey) {
        Object.keys(screens).forEach(k => {
            screens[k].classList.remove('active');
        });
        screens[screenKey].classList.add('active');
        
        // Auto scroll main viewport back to top
        document.getElementById('main-viewport').scrollTop = 0;
    }

    // Top screen Administrative Law submenu expand toggle
    const btnSubjectAdmin = document.getElementById('btn-subject-admin');
    const adminWrapper = btnSubjectAdmin.closest('.subject-group-wrapper');
    btnSubjectAdmin.addEventListener('click', (e) => {
        e.stopPropagation();
        adminWrapper.classList.toggle('expanded');
    });

    // Back Buttons
    document.getElementById('btn-back-to-top').addEventListener('click', () => {
        stopPlayback();
        showScreen('top');
    });

    document.getElementById('btn-back-to-selector').addEventListener('click', () => {
        stopPlayback();
        showScreen('selector');
    });

    // Setup direct click actions on top law cards
    document.querySelectorAll('[data-law]').forEach(card => {
        card.addEventListener('click', () => {
            const lawName = card.getAttribute('data-law');
            loadLaw(lawName);
        });
    });

    // --- Backend Fetch & Parse Client ---
    async function loadLaw(lawName) {
        currentLawName = lawName;
        lblActiveLaw.textContent = getLawNickname(lawName);
        
        // Show empty and show loading
        lawStructureContainer.innerHTML = "";
        selectorControls.classList.add('hidden');
        lawLoading.classList.remove('hidden');
        showScreen('selector');

        try {
            const response = await fetch(`/api/law?name=${encodeURIComponent(lawName)}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            lawData = await response.json();
            
            // Render articles list
            renderSelectorTree(lawData);
            
            lawLoading.classList.add('hidden');
            selectorControls.classList.remove('hidden');
        } catch (err) {
            console.error("Error loading law data:", err);
            lawStructureContainer.innerHTML = `
                <div class="law-loading">
                    <span class="card-icon" style="font-size:48px;">⚠️</span>
                    <p style="color:var(--color-danger);font-weight:700;">法令データの取得に失敗しました</p>
                    <span class="loading-sub">${err.message}</span>
                    <button class="btn-back" style="margin-top:10px;background:rgba(255,255,255,0.05);" onclick="location.reload()">再読み込み</button>
                </div>
            `;
            lawLoading.classList.add('hidden');
        }
    }

    // Helper: Map official law number to clean display title
    function getLawNickname(officialNum) {
        if (officialNum === "昭和二十一年憲法") return "日本国憲法";
        if (officialNum === "明治二十九年法律第八十九号") return "民法";
        if (officialNum === "平成五年法律第八十八号") return "行政手続法";
        if (officialNum === "平成二十六年法律第六十八号") return "行政不服審査法";
        if (officialNum === "昭和三十七年法律第百三十九号") return "行政事件訴訟法";
        if (officialNum === "昭和二十二年法律第百二十五号") return "国家賠償法";
        if (officialNum === "昭和二十二年法律第六十七号") return "地方自治法";
        return officialNum;
    }

    // --- Render Chapters & Articles Tree ---
    function renderSelectorTree(data) {
        const articles = data.articles;
        
        // 1. Group articles by Chapter
        const chapters = [];
        let currentChapter = null;

        articles.forEach((art, idx) => {
            if (favoritesOnly && !isBookmarked(idx)) return;

            const chapName = art.chapter || "本則";
            if (!currentChapter || currentChapter.name !== chapName) {
                currentChapter = {
                    name: chapName,
                    articles: []
                };
                chapters.push(currentChapter);
            }
            currentChapter.articles.push({
                article: art,
                globalIndex: idx
            });
        });

        // 2. Render Accordion structure
        lawStructureContainer.innerHTML = "";
        
        // --- RESUME BUTTON ---
        try {
            const states = JSON.parse(localStorage.getItem('gyosei_resume_state') || '{}');
            const resumeState = states[currentLawName];
            if (resumeState && resumeState.artIdx < articles.length) {
                const artInfo = articles[resumeState.artIdx];
                const resumeBtnContainer = document.createElement('div');
                resumeBtnContainer.className = 'chapter-accordion expanded';
                resumeBtnContainer.style.marginBottom = '20px';
                resumeBtnContainer.style.border = '2px solid var(--color-primary)';
                
                resumeBtnContainer.innerHTML = `
                    <button class="accordion-header" style="background: rgba(255,107,107,0.1); justify-content: center;">
                        <div class="chapter-title-text" style="color: var(--color-primary); font-weight: bold;">
                            ▶ 前回（${artInfo.title}）の続きから再生
                        </div>
                    </button>
                `;
                
                resumeBtnContainer.querySelector('button').addEventListener('click', () => {
                    selectArticle(resumeState.artIdx);
                    // Wait for DOM
                    setTimeout(() => {
                        jumpToSentence(resumeState.sentIdx);
                    }, 50);
                });
                
                lawStructureContainer.appendChild(resumeBtnContainer);
            }
        } catch (e) {
            console.error('Failed to load resume state', e);
        }

        chapters.forEach((chap, chapIdx) => {
            const accordion = document.createElement('div');
            accordion.className = `chapter-accordion ${chapIdx === 0 ? 'expanded' : ''}`;
            accordion.id = `accordion-chap-${chapIdx}`;

            const header = document.createElement('button');
            header.className = 'accordion-header';
            header.innerHTML = `
                <div class="chapter-title-text">
                    ${chap.name} <span class="chapter-count-badge">${chap.articles.length}条文</span>
                </div>
                <span class="accordion-arrow">▼</span>
            `;

            const content = document.createElement('div');
            content.className = 'accordion-content';

            chap.articles.forEach(item => {
                const artBtn = document.createElement('button');
                artBtn.className = 'article-select-btn';
                artBtn.innerHTML = `
                    <span class="btn-art-title">${item.article.title}</span>
                    ${item.article.caption ? `<span class="btn-art-caption">（${item.article.caption}）</span>` : ''}
                `;
                artBtn.addEventListener('click', () => {
                    selectArticle(item.globalIndex);
                });
                content.appendChild(artBtn);
            });

            header.addEventListener('click', () => {
                accordion.classList.toggle('expanded');
            });

            accordion.appendChild(header);
            accordion.appendChild(content);
            lawStructureContainer.appendChild(accordion);
        });
    }

    // --- Instant search filter logic ---
    inputSearch.addEventListener('input', () => {
        const query = inputSearch.value.trim().toLowerCase();
        if (query.length > 0) {
            btnClearSearch.classList.remove('hidden');
            performSearch(query);
        } else {
            btnClearSearch.classList.add('hidden');
            renderSelectorTree(lawData);
        }
    });

    btnClearSearch.addEventListener('click', () => {
        inputSearch.value = "";
        btnClearSearch.classList.add('hidden');
        renderSelectorTree(lawData);
    });

    function performSearch(query) {
        const articles = lawData.articles;
        const matches = [];

        articles.forEach((art, idx) => {
            const titleMatch = art.title.toLowerCase().includes(query);
            const numMatch = art.title.replace(/[^0-9]/g, '').includes(query); // Match raw numbers typed e.g. "94"
            const captionMatch = art.caption && art.caption.toLowerCase().includes(query);
            const contentMatch = art.fullText.toLowerCase().includes(query);

            if (titleMatch || numMatch || captionMatch || contentMatch) {
                matches.push({ article: art, globalIndex: idx });
            }
        });

        lawStructureContainer.innerHTML = "";
        if (matches.length === 0) {
            lawStructureContainer.innerHTML = `
                <div class="law-loading">
                    <span class="card-icon" style="font-size:32px;">🔍</span>
                    <p style="color:var(--color-text-secondary);">該当する条文が見つかりませんでした。</p>
                </div>
            `;
            return;
        }

        const listContainer = document.createElement('div');
        listContainer.className = 'accordion-content';
        listContainer.style.display = 'flex';
        listContainer.style.borderTop = 'none';

        const label = document.createElement('div');
        label.className = 'search-results-label';
        label.textContent = `検索結果: ${matches.length} 件`;
        lawStructureContainer.appendChild(label);

        matches.forEach(item => {
            const artBtn = document.createElement('button');
            artBtn.className = 'article-select-btn';
            artBtn.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <span class="btn-art-title">${item.article.title} ${item.article.caption ? `（${item.article.caption}）` : ''}</span>
                    <span style="font-size:0.7rem; color:var(--color-text-muted);">${item.article.chapter || '本則'}</span>
                </div>
            `;
            artBtn.addEventListener('click', () => {
                selectArticle(item.globalIndex);
            });
            listContainer.appendChild(artBtn);
        });
        lawStructureContainer.appendChild(listContainer);
    }

    // --- Loading & Setting Active Article ---
    function selectArticle(globalIndex) {
        stopPlayback();
        loadArticle(globalIndex);
        showScreen('learning');
    }

    function loadArticle(globalIndex) {
        activeArticleIndex = globalIndex;
        const art = lawData.articles[globalIndex];

        // 1. Update Labels
        lblLearningLaw.textContent = getLawNickname(lawData.law_num);
        lblLearningChapter.textContent = art.chapter || "本則";
        lblLearningTitle.textContent = art.title;

        // Swipe Buttons States
        btnPrevArticle.disabled = (getPrevPlayableIndex(globalIndex) === -1);
        btnNextArticle.disabled = (getNextPlayableIndex(globalIndex) === -1);

        // Update Favorite Button State
        const bookmarkKey = `${lawData.law_num}_${art.title}`;
        if (bookmarks[bookmarkKey]) {
            btnFavoriteArticle.classList.add('active');
        } else {
            btnFavoriteArticle.classList.remove('active');
        }

        // 2. Clear view content and build verbatim split sentences
        articleViewContent.innerHTML = "";
        sentences = [];
        activeSentenceIndex = -1;

        // Sentence 0: Article Title + Caption (for intuitive auditory context)
        const headerText = `${art.title}${art.caption ? `（${art.caption}）` : ''}`;
        sentences.push({
            index: 0,
            text: headerText,
            isHeader: true
        });

        // Set visual Title header in DOM
        const titleEl = document.getElementById('article-view-title');
        titleEl.innerHTML = `<span class="sentence" id="sentence-0">${art.title}${art.caption ? ` <span id="article-view-caption">（${art.caption}）</span>` : ''}</span>`;

        // Split body paragraphs verbatim into sentences
        let sentenceCount = 1;
        art.paragraphs.forEach(para => {
            const pNum = para.num ? `${para.num} ` : '';
            const paraTextFull = para.text;
            
            // Standard sentence split by Japanese period
            const pSentences = paraTextFull.split(/(?<=。)/g).filter(s => s.trim().length > 0);
            
            pSentences.forEach((sText, sIdx) => {
                const isIndent = sText.startsWith('  ') || sText.startsWith('　　');
                const prefix = (sIdx === 0) ? pNum : '';
                sentences.push({
                    index: sentenceCount,
                    text: prefix + sText.trim(),
                    isIndent: isIndent
                });
                
                // Render sentence element in DOM
                const span = document.createElement('span');
                span.id = `sentence-${sentenceCount}`;
                span.className = 'sentence';
                if (isIndent) span.classList.add('indent-item');
                else span.classList.add('sentence-break');
                
                span.textContent = prefix + sText;
                
                // Let user tap any sentence to jump speech instantly!
                const activeIndex = sentenceCount;
                span.addEventListener('click', (e) => {
                    e.stopPropagation();
                    jumpToSentence(activeIndex);
                });

                articleViewContent.appendChild(span);
                sentenceCount++;
            });
        });

        // Setup click listener on Sentence 0 (Title Header)
        document.getElementById('sentence-0').addEventListener('click', (e) => {
            e.stopPropagation();
            jumpToSentence(0);
        });

        // Scroll reading viewport back to top
        readingViewport.scrollTop = 0;

        // Update Media Session screen info
        updateMediaSession();
    }

    function isBookmarked(globalIndex) {
        if (!lawData || !lawData.articles[globalIndex]) return false;
        return !!bookmarks[`${lawData.law_num}_${lawData.articles[globalIndex].title}`];
    }

    function getNextPlayableIndex(currentIndex) {
        let idx = currentIndex + 1;
        while (idx < lawData.articles.length) {
            if (!favoritesOnly || isBookmarked(idx)) return idx;
            idx++;
        }
        return -1;
    }

    function getPrevPlayableIndex(currentIndex) {
        let idx = currentIndex - 1;
        while (idx >= 0) {
            if (!favoritesOnly || isBookmarked(idx)) return idx;
            idx--;
        }
        return -1;
    }

    function playPrevArticle() {
        const prevIdx = getPrevPlayableIndex(activeArticleIndex);
        if (prevIdx !== -1) {
            const autoPlayRestore = isPlaying;
            stopPlayback();
            loadArticle(prevIdx);
            if (autoPlayRestore) startPlayback();
        }
    }

    function playNextArticle() {
        const nextIdx = getNextPlayableIndex(activeArticleIndex);
        if (nextIdx !== -1) {
            const autoPlayRestore = isPlaying;
            stopPlayback();
            loadArticle(nextIdx);
            if (autoPlayRestore) startPlayback();
        }
    }

    btnPrevArticle.addEventListener('click', playPrevArticle);
    btnNextArticle.addEventListener('click', playNextArticle);

    // --- Web Speech API (TTS Core Engine) ---

    function startPlayback() {
        if (sentences.length === 0) return;
        
        isPlaying = true;
        isPaused = false;
        
        keepAliveAudio.play().catch(e => console.log("Keep-alive play failed:", e));

        statusPill.className = "active-status playing";
        statusText.textContent = "読み上げ中";
        
        btnPlay.classList.add('playing');
        playSvg.classList.add('hidden');
        pauseSvg.classList.remove('hidden');
        playBtnText.textContent = "一時停止";

        if (activeSentenceIndex === -1) {
            activeSentenceIndex = 0;
        }
        
        // Update Media Session state
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }
        updateMediaSession();
        
        playSentenceTts(activeSentenceIndex);
        requestWakeLock();
    }

    async function requestWakeLock() {
        if (!wakeLockEnabled || !isPlaying || isPaused) return;
        if ('wakeLock' in navigator) {
            try {
                if (!wakeLock) {
                    wakeLock = await navigator.wakeLock.request('screen');
                    wakeLock.addEventListener('release', () => {
                        wakeLock = null;
                    });
                }
            } catch (err) {
                console.error(`Wake Lock error: ${err.name}, ${err.message}`);
            }
        }
    }

    function releaseWakeLock() {
        if (wakeLock !== null) {
            wakeLock.release().catch(console.error);
            wakeLock = null;
        }
    }

    function pausePlayback() {
        isPaused = true;
        clearWatchdog();
        statusPill.className = "active-status paused";
        statusText.textContent = "一時停止中";
        
        btnPlay.classList.remove('playing');
        playSvg.classList.remove('hidden');
        pauseSvg.classList.add('hidden');
        playBtnText.textContent = "再開";

        keepAliveAudio.pause();
        getCurrentPlayer().pause();

        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }
        releaseWakeLock();
    }

    function resumePlayback() {
        isPaused = false;
        resetWatchdog();
        statusPill.className = "active-status playing";
        statusText.textContent = "読み上げ中";
        
        btnPlay.classList.add('playing');
        playSvg.classList.add('hidden');
        pauseSvg.classList.remove('hidden');
        playBtnText.textContent = "一時停止";

        keepAliveAudio.play().catch(e => console.log("Keep-alive play failed:", e));
        getCurrentPlayer().play().catch(err => console.log("Resume play failed:", err));

        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }
        requestWakeLock();
    }

    function stopPlayback() {
        isPlaying = false;
        isPaused = false;
        activeSentenceIndex = -1;
        clearWatchdog();

        statusPill.className = "active-status";
        statusText.textContent = "待機中";

        btnPlay.classList.remove('playing');
        playSvg.classList.remove('hidden');
        pauseSvg.classList.add('hidden');
        playBtnText.textContent = "再生";

        // Remove active visual highlights
        document.querySelectorAll('.sentence').forEach(el => {
            el.classList.remove('active');
        });

        keepAliveAudio.pause();
        audioPlayers[0].pause();
        audioPlayers[1].pause();
        audioPlayers[0].removeAttribute('src');
        audioPlayers[1].removeAttribute('src');
        audioPlayers[0].load();
        audioPlayers[1].load();

        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'none';
        }
        releaseWakeLock();
    }

    // Helper: Correct Japanese legal terminology pronunciation for browser TTS
    function correctPronunciation(text) {
        if (!text) return "";
        let result = text;

        // 1. Convert Kanji Numerals followed by a space (e.g. 一　, 二　) into '第一号', '第二号' with an auditory pause comma
        result = result.replace(/(?<=^|[\s　])([一二三四五六七八九十百]+)([　\s])/g, (match, p1, p2) => {
            return `第${p1}号、${p2}`;
        });

        // 2. Convert Arabic Numerals followed by a space (e.g. 2　, ３ ) into '第二項', '第三項' with an auditory pause comma
        result = result.replace(/(?<=^|[\s　])([0-9０-９]+)([　\s])/g, (match, p1, p2) => {
            return `第${p1}項、${p2}`;
        });

        const legalReplacements = [
            // Specific compound words with "項" or "号" must be processed first to avoid partial replacements!
            { pattern: /事項/g, replacement: 'じこう' },
            { pattern: /前([一二三四五六七八九十百千万０-９0-9]+)項/g, replacement: 'ぜん$1こう' },
            { pattern: /前項/g, replacement: 'ぜんこう' },
            { pattern: /前([一二三四五六七八九十百千万０-９0-9]+)号/g, replacement: 'ぜん$1ごう' },
            { pattern: /前号/g, replacement: 'ぜんごう' },
            { pattern: /次項/g, replacement: 'じこう' },
            { pattern: /号中/g, replacement: 'ごうちゅう' },
            { pattern: /第([一二三四五六七八九十百千万０-９0-9]+)項中/g, replacement: 'だい$1こうちゅう' },
            { pattern: /第([一二三四五六七八九十百千万０-９0-9]+)号/g, replacement: '、だい$1ごう、' },

            // Fix absolute #1 issue: "項" (unaji) and "号" (sakebi) misreadings
            { pattern: /([一二三四五六七八九十百千万０-９0-9]+)項/g, replacement: '$1こう' },
            { pattern: /([一二三四五六七八九十百千万０-９0-9]+)号/g, replacement: '$1ごう' },
            { pattern: /項/g, replacement: 'こう' },
            { pattern: /号/g, replacement: 'ごう' },

            // Constitutional & administrative terminology old kanji / special readings
            { pattern: /国事/g, replacement: 'こくじ' },
            { pattern: /皇位/g, replacement: 'こうい' },
            { pattern: /基く/g, replacement: 'もとづく' },
            { pattern: /基づく/g, replacement: 'もとづく' },
            { pattern: /基いて/g, replacement: 'もとづいて' },
            { pattern: /基づいて/g, replacement: 'もとづいて' },
            { pattern: /基ついて/g, replacement: 'もとづいて' },
            { pattern: /行って/g, replacement: 'おこなって' },
            { pattern: /行なって/g, replacement: 'おこなって' },
            { pattern: /行う/g, replacement: 'おこなう' },
            { pattern: /行なう/g, replacement: 'おこなう' },
            { pattern: /行い/g, replacement: 'おこない' },
            { pattern: /行ない/g, replacement: 'おこない' },
            { pattern: /行った/g, replacement: 'おこなった' },
            { pattern: /行なった/g, replacement: 'おこなった' },
            { pattern: /行われる/g, replacement: 'おこなわれる' },
            { pattern: /行なわれる/g, replacement: 'おこなわれる' },
            { pattern: /行われた/g, replacement: 'おこなわれた' },
            { pattern: /行なわれた/g, replacement: 'おこなわれた' },
            { pattern: /の下/g, replacement: 'のもと' },
            { pattern: /避ける/g, replacement: 'さける' },
            { pattern: /次章/g, replacement: 'じしょう' },
            { pattern: /同表/g, replacement: 'どうひょう' },
            { pattern: /請求人/g, replacement: 'せいきゅうにん' },
            { pattern: /審査関係人/g, replacement: 'しんさかんけいにん' },
            { pattern: /利害関係人/g, replacement: 'りがいかんけいにん' },
            { pattern: /参加人/g, replacement: 'さんかにん' },
            { pattern: /名宛人/g, replacement: 'なあてにん' },
            { pattern: /名あて人/g, replacement: 'なあてにん' },
            { pattern: /何人/g, replacement: 'なんぴと' },
            { pattern: /約し/g, replacement: 'やくし' },
            { pattern: /遺言者/g, replacement: 'いごんしゃ' },
            { pattern: /遺言/g, replacement: 'いごん' },
            { pattern: /兄弟姉妹/g, replacement: 'けいていしまい' },
            { pattern: /占有者/g, replacement: 'せんゆうしゃ' },
            { pattern: /占有物/g, replacement: 'せんゆうぶつ' },
            { pattern: /の他/g, replacement: 'のほか' },
            { pattern: /他の/g, replacement: 'たの' },
            { pattern: /公の/g, replacement: 'おおやけの' },
            { pattern: /公に/g, replacement: 'おおやけに' },
            { pattern: /国会/g, replacement: 'こっかい' },
            { pattern: /犯則/g, replacement: 'はんそく' },
            { pattern: /無効等確認/g, replacement: 'むこうとうかくにん' },
            { pattern: /補助人/g, replacement: 'ほじょにん' },
            { pattern: /負ふ/g, replacement: 'おう' },
            { pattern: /行ふ/g, replacement: 'おこなう' },
            { pattern: /賜与/g, replacement: 'しよ' },
            { pattern: /永久/g, replacement: 'えいきゅう' },
            { pattern: /伴はない/g, replacement: 'ともなわない' },
            { pattern: /その他/g, replacement: 'そのた' },
            { pattern: /当たつた/g, replacement: 'あたった' },
            { pattern: /場合/g, replacement: 'ばあい' },

            
            // Suffix '所' (jo) legal specific readings
            { pattern: /居所/g, replacement: 'きょしょ' },
            { pattern: /登記所/g, replacement: 'とうきじょ' },
            { pattern: /取引所/g, replacement: 'とりひきじょ' },
            { pattern: /集会所/g, replacement: 'しゅうかいじょ' },
            { pattern: /研究所/g, replacement: 'けんきゅうじょ' },


            { pattern: /相殺/g, replacement: 'そうさい' },
            { pattern: /瑕疵/g, replacement: 'かし' },





            { pattern: /違背/g, replacement: 'いはい' },
            { pattern: /遺贈/g, replacement: 'いぞう' },
            { pattern: /勾留/g, replacement: 'こうりゅう' },
            { pattern: /拘留/g, replacement: 'こうりゅう' },
            { pattern: /且つ/g, replacement: 'かつ' },
            { pattern: /罷免/g, replacement: 'ひめん' },
            { pattern: /弾劾/g, replacement: 'だんがい' },
            { pattern: /彈劾/g, replacement: 'だんがい' },
            { pattern: /召集/g, replacement: 'しょうしゅう' },

            
            // Civil Law specific pronunciations (crucial for scrivener studies)
            { pattern: /遺言/g, replacement: 'いごん' }, // TTS normally says "ゆいごん", legal reading is strictly "いごん"
            { pattern: /占有/g, replacement: 'せんゆう' },
            { pattern: /善意/g, replacement: 'ぜんい' },
            { pattern: /悪意/g, replacement: 'あくい' },
            { pattern: /過失/g, replacement: 'かしつ' },
            { pattern: /第三者/g, replacement: 'だいさんしゃ' },
            { pattern: /物権/g, replacement: 'ぶっけん' },
            { pattern: /債権者/g, replacement: 'さいけんしゃ' },
            { pattern: /債権/g, replacement: 'さいけん' },
            { pattern: /先取特権者/g, replacement: 'さきどりとっけんしゃ' },
            { pattern: /先取特権/g, replacement: 'さきどりとっけん' },
            { pattern: /留置物/g, replacement: 'りゅうちぶつ' },
            { pattern: /質物/g, replacement: 'しちぶつ' },
            { pattern: /有体物/g, replacement: 'ゆうたいぶつ' },
            { pattern: /無主物/g, replacement: 'むしゅぶつ' },
            { pattern: /表見代理/g, replacement: 'ひょうけんだいり' }
        ];

        legalReplacements.forEach(item => {
            result = result.replace(item.pattern, item.replacement);
        });

        return result;
    }

    // --- Native Ping-Pong Preloader ---
    function preloadNativeAudio(artIdx, sentIdx) {
        let a = artIdx;
        let s = sentIdx + 1;
        let nextText = null;

        if (s < sentences.length) {
            nextText = sentences[s].text;
        } else {
            a = getNextPlayableIndex(artIdx);
            if (a !== -1 && autoplayEnabled) {
                const art = lawData.articles[a];
                nextText = `${art.title}${art.caption ? `（${art.caption}）` : ''}`;
            }
        }

        if (nextText) {
            const cleanText = correctPronunciation(nextText).trim();
            if (!cleanText) return;
            
            const nextUrl = getTtsUrl(cleanText);
            const nextPlayer = getNextPlayer();
            
            // Checking endsWith ensures we don't reload if it's already loading this URL
            if (!nextPlayer.src.endsWith(nextUrl)) {
                nextPlayer.src = nextUrl;
                nextPlayer.preload = "auto";
                nextPlayer.load(); // Triggers browser's native background fetching!
            } else if (nextPlayer.ended) {
                // If text is identical to a previous track but finished, reload it
                nextPlayer.load();
            }
        }
    }

    // --- Google High-Quality TTS Audio Engine (Server-side Proxied) ---
    function getTtsUrl(text) {
        return `/api/tts?text=${encodeURIComponent(text)}`;
    }

    function highlightSentence(index) {
        document.querySelectorAll('.sentence').forEach(el => {
            el.classList.remove('active');
        });
        
        const activeSpan = document.getElementById(`sentence-${index}`);
        if (activeSpan) {
            activeSpan.classList.add('active');
            activeSpan.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }

    function saveResumeState() {
        if (!currentLawName || activeArticleIndex === -1 || activeSentenceIndex === -1) return;
        try {
            const states = JSON.parse(localStorage.getItem('gyosei_resume_state') || '{}');
            states[currentLawName] = {
                artIdx: activeArticleIndex,
                sentIdx: activeSentenceIndex
            };
            localStorage.setItem('gyosei_resume_state', JSON.stringify(states));
        } catch (e) {
            console.error('Failed to save resume state', e);
        }
    }

    function playSentenceTts(index) {
        if (!isPlaying) return;

        activeSentenceIndex = index;
        saveResumeState();
        
        const currentSentence = sentences[index];
        highlightSentence(index);

        const player = getCurrentPlayer();
        const ttsText = correctPronunciation(currentSentence.text).trim();
        
        if (!ttsText) {
            hasTransitioned = true;
            setTimeout(() => { playNextTrack(); }, 50);
            return;
        }

        const url = getTtsUrl(ttsText);

        if (!player.src.endsWith(url)) {
            player.src = url;
            player.load();
        } else if (player.ended || player.currentTime > 0) {
            player.currentTime = 0; // Reset just in case
        }
        
        player.playbackRate = speechRate * 1.5;
        resetWatchdog();
        player.play().catch(err => {
            console.error("HTML5 TTS Play failed:", err);
            if (err.name === "NotAllowedError") {
                pausePlayback();
            } else {
                if (isPlaying && !isPaused && !hasTransitioned) {
                    hasTransitioned = true;
                    setTimeout(() => { playNextTrack(); }, 100);
                }
            }
        });

        hasTransitioned = false;

        // Only preload if the old player has finished playing (e.g. initial start or jump).
        // If it's still playing its overlap tail, its 'ended' event will trigger the preload.
        if (getNextPlayer().paused || getNextPlayer().ended) {
            preloadNativeAudio(activeArticleIndex, index);
        }
    }

    function playNextTrack() {
        let nextIndex = activeSentenceIndex + 1;
        let nextArtIdx = activeArticleIndex;

        if (nextIndex >= sentences.length) {
            if (!autoplayEnabled) {
                stopPlayback();
                return;
            }
            nextArtIdx = getNextPlayableIndex(activeArticleIndex);
            if (nextArtIdx === -1) {
                stopPlayback();
                return;
            }
            loadArticle(nextArtIdx);
            nextIndex = 0;
        }

        currentPlayerIndex = 1 - currentPlayerIndex;
        if (isPlaying) {
            playSentenceTts(nextIndex);
        }
    }

    // Bind core HTML5 Audio Event Listeners to BOTH players
    function onTimeUpdate(e) {
        if (!isPlaying || isPaused || hasTransitioned) return;
        const player = e.target;
        if (player !== getCurrentPlayer()) return;

        resetWatchdog();

        // Overlap: trigger next track 0.3s before current one ends
        // This ensures the background OS lock never releases between sentences!
        if (player.duration && player.currentTime) {
            const timeLeft = player.duration - player.currentTime;
            if (timeLeft <= 0.3) {
                hasTransitioned = true;
                playNextTrack();
            }
        }
    }

    function onPlayerEnded(e) {
        const player = e.target;
        
        if (player === getCurrentPlayer()) {
            // Fallback: If timeupdate failed to fire early enough
            if (!hasTransitioned && isPlaying && !isPaused) {
                hasTransitioned = true;
                playNextTrack();
            }
        } else {
            // The INACTIVE player just finished playing its tail-end overlap.
            // It is now fully free, so we can preload the NEXT track for it.
            if (isPlaying && !isPaused) {
                preloadNativeAudio(activeArticleIndex, activeSentenceIndex);
            }
        }
    }

    function onPlayerError(e) {
        console.error("HTML5 TTS Audio element error:", e);
        const player = e.target;
        if (player === getCurrentPlayer() && isPlaying && !isPaused) {
            hasTransitioned = true;
            playNextTrack();
        }
    }

    audioPlayers[0].addEventListener('timeupdate', onTimeUpdate);
    audioPlayers[1].addEventListener('timeupdate', onTimeUpdate);
    audioPlayers[0].addEventListener('ended', onPlayerEnded);
    audioPlayers[1].addEventListener('ended', onPlayerEnded);
    audioPlayers[0].addEventListener('error', onPlayerError);
    audioPlayers[1].addEventListener('error', onPlayerError);

    function jumpToSentence(index) {
        if (!lawData) return;
        const autoPlayRestore = isPlaying || isPaused;
        
        activeSentenceIndex = index;
        saveResumeState();
        
        if (autoPlayRestore) {
            isPlaying = true;
            isPaused = false;
            
            keepAliveAudio.play().catch(e => console.log("Keep-alive failed:", e));

            statusPill.className = "active-status playing";
            statusText.textContent = "読み上げ中";
            btnPlay.classList.add('playing');
            playSvg.classList.add('hidden');
            pauseSvg.classList.remove('hidden');
            playBtnText.textContent = "一時停止";

            playSentenceTts(index);
        } else {
            highlightSentence(index);
        }
    }

    // Playback control trigger
    btnPlay.addEventListener('click', () => {
        if (!isPlaying) {
            startPlayback();
        } else if (isPaused) {
            resumePlayback();
        } else {
            pausePlayback();
        }
    });

    btnStop.addEventListener('click', () => {
        stopPlayback();
    });

    // --- Interactive Speed Rate Slider ---
    sliderSpeed.addEventListener('input', () => {
        const value = parseFloat(sliderSpeed.value);
        setSpeechRate(value);
    });

    // Preset Speed Card clicks
    document.querySelectorAll('.btn-preset-speed').forEach(btn => {
        btn.addEventListener('click', () => {
            const value = parseFloat(btn.getAttribute('data-speed'));
            sliderSpeed.value = value;
            setSpeechRate(value);
        });
    });

    function setSpeechRate(rate) {
        speechRate = rate;
        lblSpeedValue.textContent = `${rate.toFixed(1)}x`;

        // Update active class on preset button
        document.querySelectorAll('.btn-preset-speed').forEach(btn => {
            const btnVal = parseFloat(btn.getAttribute('data-speed'));
            if (Math.abs(btnVal - rate) < 0.05) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Dynamic rate change if currently reading
        if (isPlaying && !isPaused && activeSentenceIndex !== -1) {
            audioPlayers[0].playbackRate = rate * 1.5;
            audioPlayers[1].playbackRate = rate * 1.5;
        }
    }

    // Initialize default preset active state
    setSpeechRate(1.0);

    // --- Config Toggles Hooking ---
    switchAutoplay.addEventListener('change', () => {
        autoplayEnabled = switchAutoplay.checked;
    });

    switchFavoritesOnly.addEventListener('change', () => {
        favoritesOnly = switchFavoritesOnly.checked;
        if (lawData) {
            renderSelectorTree(lawData);
        }
    });

    btnFavoriteArticle.addEventListener('click', () => {
        if (!lawData || activeArticleIndex === -1) return;
        const art = lawData.articles[activeArticleIndex];
        const bookmarkKey = `${lawData.law_num}_${art.title}`;
        
        if (bookmarks[bookmarkKey]) {
            delete bookmarks[bookmarkKey];
            btnFavoriteArticle.classList.remove('active');
        } else {
            bookmarks[bookmarkKey] = true;
            btnFavoriteArticle.classList.add('active');
        }
        saveBookmarks();
    });

    // Wake Lock Toggle
    switchWakelock.addEventListener('change', () => {
        wakeLockEnabled = switchWakelock.checked;
        if (wakeLockEnabled) {
            requestWakeLock();
        } else {
            releaseWakeLock();
        }
    });

    // Re-request wake lock on visibility change
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            requestWakeLock();
        }
    });

    // Deep Focus Mode Toggle
    switchFocus.addEventListener('change', () => {
        focusModeEnabled = switchFocus.checked;
        if (focusModeEnabled) {
            document.body.classList.add('focus-mode-active');
        } else {
            document.body.classList.remove('focus-mode-active');
        }
    });

    // --- Media Session Helper Functions ---
    function updateMediaSession() {
        if ('mediaSession' in navigator && lawData && activeArticleIndex !== -1) {
            const art = lawData.articles[activeArticleIndex];
            const lawNickname = getLawNickname(lawData.law_num);
            
            navigator.mediaSession.metadata = new MediaMetadata({
                title: `${art.title} ${art.caption ? `（${art.caption}）` : ''}`,
                artist: lawNickname,
                album: '行政書士 条文暗記'
            });
        }
    }

    function setupMediaSessionHandlers() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => {
                if (isPaused) {
                    resumePlayback();
                } else if (!isPlaying) {
                    startPlayback();
                }
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                if (isPlaying && !isPaused) {
                    pausePlayback();
                }
            });
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                playPrevArticle();
            });
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                playNextArticle();
            });
        }
    }

    // Initialize Media Session Handlers
    setupMediaSessionHandlers();

    // Cancel speech when leaving or closing tab
    window.addEventListener('beforeunload', () => {
        window.speechSynthesis.cancel();
    });
});
