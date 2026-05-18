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
    let speechRate = 1.0;
    
    // UI Layout Configuration
    let fontSize = "medium"; // small, medium, large, xlarge

    // Speech Engine Instance
    let currentUtterance = null;

    // TTS Audio Player (Using HTML5 Audio to bypass Web Speech API background restrictions)
    const ttsAudio = new Audio();

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
        btnPrevArticle.disabled = (globalIndex === 0);
        btnNextArticle.disabled = (globalIndex === lawData.articles.length - 1);

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
            
            pSentences.forEach((sText) => {
                const isIndent = sText.startsWith('  ') || sText.startsWith('　　');
                sentences.push({
                    index: sentenceCount,
                    text: pNum + sText.trim(),
                    isIndent: isIndent
                });
                
                // Render sentence element in DOM
                const span = document.createElement('span');
                span.id = `sentence-${sentenceCount}`;
                span.className = 'sentence';
                if (isIndent) span.classList.add('indent-item');
                else span.classList.add('sentence-break');
                
                span.textContent = pNum + sText;
                
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

    function playPrevArticle() {
        if (activeArticleIndex > 0) {
            const autoPlayRestore = isPlaying;
            stopPlayback();
            loadArticle(activeArticleIndex - 1);
            if (autoPlayRestore) startPlayback();
        }
    }

    function playNextArticle() {
        if (activeArticleIndex < lawData.articles.length - 1) {
            const autoPlayRestore = isPlaying;
            stopPlayback();
            loadArticle(activeArticleIndex + 1);
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
    }

    function pausePlayback() {
        isPaused = true;
        statusPill.className = "active-status paused";
        statusText.textContent = "一時停止中";
        
        btnPlay.classList.remove('playing');
        playSvg.classList.remove('hidden');
        pauseSvg.classList.add('hidden');
        playBtnText.textContent = "再開";

        ttsAudio.pause();

        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }
    }

    function resumePlayback() {
        isPaused = false;
        statusPill.className = "active-status playing";
        statusText.textContent = "読み上げ中";
        
        btnPlay.classList.add('playing');
        playSvg.classList.add('hidden');
        pauseSvg.classList.remove('hidden');
        playBtnText.textContent = "一時停止";

        ttsAudio.play().catch(err => console.log("Resume play failed:", err));

        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }
    }

    function stopPlayback() {
        isPlaying = false;
        isPaused = false;
        activeSentenceIndex = -1;

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

        ttsAudio.pause();
        ttsAudio.src = ""; // Clear audio source

        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'none';
        }
    }

    // Helper: Correct Japanese legal terminology pronunciation for browser TTS
    function correctPronunciation(text) {
        if (!text) return "";
        let result = text;

        const legalReplacements = [
            // Specific compound words with "項" or "号" must be processed first to avoid partial replacements!
            { pattern: /事項/g, replacement: 'じこう' },

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
            { pattern: /次章/g, replacement: 'じしょう' },
            { pattern: /国会/g, replacement: 'こっかい' },
            { pattern: /犯則/g, replacement: 'はんそく' },
            { pattern: /無効等確認/g, replacement: 'むこうとうかくにん' },

            
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
            { pattern: /債権/g, replacement: 'さいけん' },
            { pattern: /有体物/g, replacement: 'ゆうたいぶつ' },
            { pattern: /無主物/g, replacement: 'むしゅぶつ' },
            { pattern: /表見代理/g, replacement: 'ひょうけんだいり' }
        ];

        legalReplacements.forEach(item => {
            result = result.replace(item.pattern, item.replacement);
        });

        return result;
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

    function playSentenceTts(index) {
        if (!isPlaying) return;

        activeSentenceIndex = index;
        const currentSentence = sentences[index];

        // 1. Highlight visual sentence
        highlightSentence(index);

        // 2. Play Audio via TTS URL
        const ttsText = correctPronunciation(currentSentence.text);
        
        // Google TTS URL
        ttsAudio.src = getTtsUrl(ttsText);
        ttsAudio.playbackRate = speechRate; // Apply custom user speech speed rate

        ttsAudio.play().catch(err => {
            console.error("HTML5 TTS Play failed:", err);
            // Handle autoplay blocking if user didn't interact
            if (err.name === "NotAllowedError") {
                pausePlayback();
            }
        });
    }

    // Bind core HTML5 Audio Event Listeners
    ttsAudio.addEventListener('ended', () => {
        if (isPlaying && !isPaused) {
            const nextIndex = activeSentenceIndex + 1;
            if (nextIndex < sentences.length) {
                // Play next sentence in current article
                playSentenceTts(nextIndex);
            } else {
                // Completed reading entire article
                if (autoplayEnabled) {
                    const nextArtIdx = activeArticleIndex + 1;
                    if (nextArtIdx < lawData.articles.length) {
                        loadArticle(nextArtIdx);
                        // Small pause between articles
                        setTimeout(() => {
                            if (isPlaying) playSentenceTts(0);
                        }, 800);
                    } else {
                        stopPlayback();
                    }
                } else {
                    stopPlayback();
                }
            }
        }
    });

    ttsAudio.addEventListener('error', (e) => {
        console.error("HTML5 TTS Audio element error:", e);
        // Skip current sentence if it fails to load
        if (isPlaying && !isPaused) {
            const nextIndex = activeSentenceIndex + 1;
            if (nextIndex < sentences.length) {
                setTimeout(() => playSentenceTts(nextIndex), 500);
            } else {
                stopPlayback();
            }
        }
    });

    function jumpToSentence(index) {
        if (!lawData) return;
        const autoPlayRestore = isPlaying || isPaused;
        
        activeSentenceIndex = index;
        
        if (autoPlayRestore) {
            isPlaying = true;
            isPaused = false;
            
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
            ttsAudio.playbackRate = rate;
        }
    }

    // Initialize default preset active state
    setSpeechRate(1.0);

    // --- Config Toggles Hooking ---
    switchAutoplay.addEventListener('change', () => {
        autoplayEnabled = switchAutoplay.checked;
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
