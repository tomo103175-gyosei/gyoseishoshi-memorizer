const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const CACHE_DIR = process.env.VERCEL
    ? path.join('/tmp', 'data', 'cache')
    : path.join(__dirname, 'data', 'cache');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Create directories if they don't exist
fs.mkdirSync(CACHE_DIR, { recursive: true });

// Serve static files
app.use(express.static(PUBLIC_DIR));

// Helper: HTTP GET request as Promise
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (res) => {
            res.setEncoding('utf8');
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    body: data
                });
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// Helper: Recursively extract inner text from a JSON tree node
function getInnerText(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node.children)) {
        return node.children.map(getInnerText).join('');
    }
    return '';
}

// Helper: Parser for e-Gov Law JSON Tree
function parseLawJson(lawData) {
    const root = lawData.law_full_text;
    const articles = [];
    
    let currentBook = '';
    let currentPart = '';
    let currentChapter = '';
    let currentSection = '';
    let currentSubsection = '';

    function traverse(node) {
        if (!node || typeof node !== 'object') return;

        if (node.tag === 'BookTitle') {
            currentBook = getInnerText(node);
            currentPart = '';
            currentChapter = '';
            currentSection = '';
            currentSubsection = '';
        } else if (node.tag === 'PartTitle') {
            currentPart = getInnerText(node);
            currentChapter = '';
            currentSection = '';
            currentSubsection = '';
        } else if (node.tag === 'ChapterTitle') {
            currentChapter = getInnerText(node);
            currentSection = '';
            currentSubsection = '';
        } else if (node.tag === 'SectionTitle') {
            currentSection = getInnerText(node);
            currentSubsection = '';
        } else if (node.tag === 'SubsectionTitle') {
            currentSubsection = getInnerText(node);
        } else if (node.tag === 'Article') {
            const article = parseArticle(node);
            article.book = currentBook;
            article.part = currentPart;
            article.chapter = currentChapter;
            article.section = currentSection;
            article.subsection = currentSubsection;
            articles.push(article);
            return; // Articles are self-contained, do not recurse inside here in outer traverse
        }

        if (Array.isArray(node.children)) {
            for (const child of node.children) {
                traverse(child);
            }
        }
    }

    function parseArticle(node) {
        let caption = '';
        let title = '';
        const paragraphs = [];

        if (Array.isArray(node.children)) {
            for (const child of node.children) {
                if (child.tag === 'ArticleCaption') {
                    caption = getInnerText(child).replace(/[（）()]/g, '').trim();
                } else if (child.tag === 'ArticleTitle') {
                    title = getInnerText(child).trim();
                } else if (child.tag === 'Paragraph') {
                    paragraphs.push(parseParagraph(child));
                }
            }
        }

        // Full text of the article reconstructed verbatim
        const fullText = paragraphs.map(p => {
            const pNum = p.num ? `${p.num} ` : '';
            return pNum + p.text;
        }).join('\n');

        return {
            title,
            caption,
            paragraphs,
            fullText
        };
    }

    function parseParagraph(node) {
        let num = '';
        let text = '';
        const items = [];

        // Check ParagraphNum
        const pNumNode = node.children?.find(c => c.tag === 'ParagraphNum');
        if (pNumNode) {
            num = getInnerText(pNumNode).trim();
        }

        // Check ParagraphSentence and sub-items
        if (Array.isArray(node.children)) {
            for (const child of node.children) {
                if (child.tag === 'ParagraphSentence') {
                    text = getInnerText(child).trim();
                } else if (child.tag === 'Item') {
                    items.push(parseItem(child));
                }
            }
        }

        // Append items if any
        if (items.length > 0) {
            text += '\n' + items.map(item => `  ${item.num} ${item.text}`).join('\n');
        }

        return {
            num,
            text
        };
    }

    function parseItem(node) {
        let num = '';
        let text = '';

        const itemTitleNode = node.children?.find(c => c.tag === 'ItemTitle');
        if (itemTitleNode) {
            num = getInnerText(itemTitleNode).trim();
        }

        const itemSentenceNode = node.children?.find(c => c.tag === 'ItemSentence');
        if (itemSentenceNode) {
            text = getInnerText(itemSentenceNode).trim();
        }

        return {
            num,
            text
        };
    }

    traverse(root);

    return {
        law_title: lawData.revision_info?.law_title || "不明な法令",
        law_num: lawData.law_info?.law_num || "",
        articles: articles
    };
}

// REST API endpoint: Get parsed law data
app.get('/api/law', async (req, res) => {
    const lawName = req.query.name;
    if (!lawName) {
        return res.status(400).json({ error: "Missing 'name' parameter." });
    }

    // Standardize filename
    const safeFilename = encodeURIComponent(lawName).replace(/%/g, '_') + '.json';
    const cachePath = path.join(CACHE_DIR, safeFilename);

    // 1. Check Cache
    if (fs.existsSync(cachePath)) {
        try {
            const cachedContent = fs.readFileSync(cachePath, 'utf8');
            console.log(`[Cache Hit] Serving cached law: ${lawName}`);
            return res.json(JSON.parse(cachedContent));
        } catch (err) {
            console.error(`Error reading cache for ${lawName}, fetching new:`, err.message);
        }
    }

    // 2. Fetch from e-Gov API v2
    console.log(`[Cache Miss] Fetching live data from e-Gov API v2: ${lawName}`);
    try {
        const encodedNum = encodeURIComponent(lawName);
        const apiUrl = `https://laws.e-gov.go.jp/api/2/law_data/${encodedNum}?response_format=json`;
        
        const apiResponse = await fetchUrl(apiUrl);
        if (apiResponse.statusCode !== 200) {
            console.error(`e-Gov API returned status ${apiResponse.statusCode} for ${lawName}`);
            return res.status(apiResponse.statusCode).json({
                error: `e-Gov API returned error status: ${apiResponse.statusCode}`,
                details: apiResponse.body
            });
        }

        // Parse & Standardize
        const rawJson = JSON.parse(apiResponse.body);
        const parsedLaw = parseLawJson(rawJson);

        // Cache result
        fs.writeFileSync(cachePath, JSON.stringify(parsedLaw, null, 2), 'utf8');
        console.log(`[Parsed & Cached] Successfully saved cache for: ${lawName}`);

        return res.json(parsedLaw);
    } catch (err) {
        console.error(`Exception during fetching/parsing ${lawName}:`, err);
        return res.status(500).json({
            error: "Failed to fetch or parse law data.",
            details: err.message
        });
    }
});

// Helper to safely chunk long Japanese text
function chunkText(text, maxLength) {
    const chunks = [];
    let currentChunk = '';
    const segments = text.split(/(?<=[、。，．])/g); 
    for (const segment of segments) {
        if (currentChunk.length + segment.length <= maxLength) {
            currentChunk += segment;
        } else {
            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = '';
            }
            if (segment.length > maxLength) {
                let tempSeg = segment;
                while (tempSeg.length > maxLength) {
                    chunks.push(tempSeg.substring(0, maxLength));
                    tempSeg = tempSeg.substring(maxLength);
                }
                currentChunk = tempSeg;
            } else {
                currentChunk = segment;
            }
        }
    }
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }
    return chunks;
}

// REST API endpoint: TTS Proxy to safely request Google Translation TTS audio
app.get('/api/tts', (req, res) => {
    const text = req.query.text;
    if (!text) {
        return res.status(400).json({ error: "Missing 'text' parameter." });
    }

    const chunks = chunkText(text, 200);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    function fetchAndPipe(index) {
        if (index >= chunks.length) {
            res.end();
            return;
        }
        
        const chunkTextEncoded = encodeURIComponent(chunks[index]);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ja&client=tw-ob&q=${chunkTextEncoded}`;
        
        https.get(ttsUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://translate.google.com/'
            }
        }, (googleRes) => {
            if (googleRes.statusCode !== 200) {
                console.error(`Google TTS chunk ${index} failed with status ${googleRes.statusCode}`);
                return fetchAndPipe(index + 1);
            }
            googleRes.pipe(res, { end: false });
            googleRes.on('end', () => {
                fetchAndPipe(index + 1);
            });
        }).on('error', (err) => {
            console.error("Google TTS Proxy chunk error:", err);
            fetchAndPipe(index + 1);
        });
    }

    fetchAndPipe(0);
});

// Fallback to serve SPA index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Export Express App for serverless environments (Vercel)
module.exports = app;

// Start Server locally if run directly
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`==================================================`);
        console.log(`🚀 Server running locally at http://localhost:${PORT}`);
        console.log(`📂 Cache Directory: ${CACHE_DIR}`);
        console.log(`📂 Public Directory: ${PUBLIC_DIR}`);
        console.log(`==================================================`);
    });
}
