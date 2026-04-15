const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PDFParse } = require('pdf-parse');
const Tesseract = require('tesseract.js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_this';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'openai').toLowerCase();

const CASES_FILE = path.join(__dirname, 'data', 'cases.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const SESSIONS_FILE = path.join(__dirname, 'data', 'sessions.json');
const REFRESH_COOKIE_NAME = 'claimshield_refresh';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const LANGUAGE_PACKS = {
  en: {
    dateLabel: 'Date',
    toLabel: 'To',
    officerLine: 'The Grievance Redressal Officer,',
    subjectLine: 'Subject: Appeal Against Claim Denial',
    greeting: 'Respected Sir/Madam,',
    intro: 'I respectfully appeal the denial of claim {claimId} under policy {policyNumber}.',
    context: 'The denial appears to rely on disputed interpretation of policy terms and/or documentation issues.',
    request: 'I request a clause-wise review and reconsideration based on the attached records.',
    escalation: 'If this matter is not resolved within the prescribed timeline, I reserve the right to approach higher grievance forums including the Insurance Ombudsman and IRDAI channels.',
    closing: 'Sincerely,'
  },
  hi: {
    dateLabel: 'दिनांक',
    toLabel: 'प्रति',
    officerLine: 'शिकायत निवारण अधिकारी महोदय/महोदया,',
    subjectLine: 'विषय: दावा अस्वीकृति के विरुद्ध अपील',
    greeting: 'आदरणीय महोदय/महोदया,',
    intro: 'मैं पॉलिसी {policyNumber} के अंतर्गत दावा {claimId} की अस्वीकृति के विरुद्ध औपचारिक अपील प्रस्तुत करता/करती हूँ।',
    context: 'अस्वीकृति प्रतीत होती है कि पॉलिसी शर्तों की विवादित व्याख्या और/या दस्तावेज़ संबंधी मुद्दों पर आधारित है।',
    request: 'कृपया संलग्न अभिलेखों के आधार पर खंड-वार समीक्षा और पुनर्विचार करें।',
    escalation: 'यदि यह मामला निर्धारित समयसीमा में हल नहीं होता है, तो मैं बीमा लोकपाल और IRDAI शिकायत चैनलों सहित उच्च मंचों पर जाने का अधिकार सुरक्षित रखता/रखती हूँ।',
    closing: 'सादर,'
  },
  kn: {
    dateLabel: 'ದಿನಾಂಕ',
    toLabel: 'ಗೆ',
    officerLine: 'ಕುಂದುಕೊರತೆ ನಿವಾರಣಾ ಅಧಿಕಾರಿಗೆ,',
    subjectLine: 'ವಿಷಯ: ಕ್ಲೇಮ್ ನಿರಾಕರಣೆಯ ವಿರುದ್ಧ ಅಪೀಲು',
    greeting: 'ಮಾನ್ಯರೇ,',
    intro: 'ಪಾಲಿಸಿ {policyNumber} ಅಡಿಯಲ್ಲಿ ಕ್ಲೇಮ್ {claimId} ನಿರಾಕರಣೆಯ ವಿರುದ್ಧ ನಾನು ಈ ಮೂಲಕ ಅಧಿಕೃತ ಅಪೀಲು ಸಲ್ಲಿಸುತ್ತಿದ್ದೇನೆ.',
    context: 'ನಿರಾಕರಣೆ ಪಾಲಿಸಿ ನಿಯಮಗಳ ವಿವಾದಾತ್ಮಕ ವ್ಯಾಖ್ಯಾನ ಮತ್ತು/ಅಥವಾ ದಾಖಲೆ ಸಮಸ್ಯೆಗಳ ಮೇಲೆ ಆಧಾರಿತವಾಗಿರುವಂತೆ ಕಾಣುತ್ತದೆ.',
    request: 'ಸಂಲಗ್ನ ದಾಖಲೆಗಳ ಆಧಾರದ ಮೇಲೆ ದಯವಿಟ್ಟು ವಿಭಾಗ-ಮಟ್ಟದ ಪರಿಶೀಲನೆ ಮಾಡಿ ಮತ್ತು ಮರುಪರಿಶೀಲಿಸಿ.',
    escalation: 'ನಿರ್ದಿಷ್ಟ ಸಮಯದಲ್ಲಿ ಈ ವಿಷಯ ಬಗೆಹರಿಯದಿದ್ದರೆ, ನಾನು ಇನ್ಶುರೆನ್ಸ್ ಒಂಬುಡ್ಸ್‌ಮನ್ ಮತ್ತು IRDAI ಮಾರ್ಗಗಳನ್ನು ಅನುಸರಿಸುವ ಹಕ್ಕನ್ನು ಕಾಯ್ದಿರುತ್ತೇನೆ.',
    closing: 'ವಂದನೆಗಳೊಂದಿಗೆ,'
  },
  ta: {
    dateLabel: 'தேதி',
    toLabel: 'அனுப்புநர்',
    officerLine: 'குறைதீர்ப்பு அலுவலருக்கு,',
    subjectLine: 'பொருள்: கோரிக்கை நிராகரிப்புக்கு எதிரான முறையீடு',
    greeting: 'மதிப்பிற்குரியவரே,',
    intro: 'கொள்கை {policyNumber} கீழ் எனது கோரிக்கை {claimId} நிராகரிக்கப்பட்டதை எதிர்த்து நான் இந்த முறையீட்டை சமர்ப்பிக்கிறேன்.',
    context: 'நிராகரிப்பு கொள்கை விதிகளின் முரண்பட்ட விளக்கம் மற்றும்/அல்லது ஆவணச் சிக்கல்களின் அடிப்படையில் இருப்பதாக தெரிகிறது.',
    request: 'இணைக்கப்பட்ட பதிவுகளின் அடிப்படையில் பிரிவு வாரியான மறுஆய்வு மற்றும் மறுபரிசீலனை செய்யுமாறு கேட்டுக்கொள்கிறேன்.',
    escalation: 'இந்த விவகாரம் குறிப்பிடப்பட்ட காலக்கெடுவிற்குள் தீர்க்கப்படாவிட்டால், Insurance Ombudsman மற்றும் IRDAI வழிகளுக்கு செல்லும் உரிமையை நான் பாதுகாத்துக் கொள்கிறேன்.',
    closing: 'மரியாதையுடன்,'
  },
  te: {
    dateLabel: 'తేదీ',
    toLabel: 'కు',
    officerLine: 'ఫిర్యాదు పరిష్కార అధికారి గారికి,',
    subjectLine: 'విషయం: క్లెయిమ్ తిరస్కరణపై అప్పీల్',
    greeting: 'గౌరవనీయులారా,',
    intro: 'పాలసీ {policyNumber} కింద నా క్లెయిమ్ {claimId} తిరస్కరణపై నేను ఈ అప్పీల్‌ను సమర్పిస్తున్నాను.',
    context: 'తిరస్కరణ పాలసీ నిబంధనల వివాదాస్పద వ్యాఖ్యానం మరియు/లేదా పత్రాల సమస్యలపై ఆధారపడినట్లు కనిపిస్తోంది.',
    request: 'జతచేసిన రికార్డుల ఆధారంగా దయచేసి క్లాజ్-వారీగా సమీక్ష చేసి పునర్విచారించండి.',
    escalation: 'ఈ విషయం నిర్ణీత సమయంలో పరిష్కరించబడకపోతే, Insurance Ombudsman మరియు IRDAI మార్గాలను ఆశ్రయించే హక్కును నేను కలిగి ఉంటాను.',
    closing: 'ఆదరాభిమానాలతో,'
  },
  ml: {
    dateLabel: 'തീയതി',
    toLabel: 'ക്ക്',
    officerLine: 'പരാതി പരിഹാര ഉദ്യോഗസ്ഥന്‍,',
    subjectLine: 'വിഷയം: ക്ലെയിം നിരാകരണത്തിനെതിരായ അപ്പീൽ',
    greeting: 'മാന്യരേ,',
    intro: 'പോളിസി {policyNumber} പ്രകാരം എന്റെ ക്ലെയിം {claimId} നിരാകരിച്ച നടപടിക്കെതിരെ ഞാൻ ഔപചാരിക അപ്പീൽ സമർപ്പിക്കുന്നു.',
    context: 'നിരാകരണം പോളിസി വ്യവസ്ഥകളുടെ വിവാദ വ്യാഖ്യാനത്തിലും/അഥവാ രേഖാ പ്രശ്നങ്ങളിലും ആധാരപെട്ടതുപോലെ തോന്നുന്നു.',
    request: 'അറ്റാച്ചുചെയ്ത രേഖകളുടെ അടിസ്ഥാനത്തിൽ ദയവായി വകുപ്പുതല അവലോകനവും പുനഃപരിശോധനയും നടത്തുക.',
    escalation: 'ഈ വിഷയം നിശ്ചിത സമയപരിധിക്കുള്ളിൽ പരിഹരിക്കപ്പെടാത്ത പക്ഷം, Insurance Ombudsman, IRDAI വഴികൾ തേടുന്നതിനുള്ള അവകാശം ഞാൻ സൂക്ഷിക്കുന്നു.',
    closing: 'ആദരപൂർവ്വം,'
  }
};

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataFiles() {
  if (!fs.existsSync(CASES_FILE)) fs.writeFileSync(CASES_FILE, '[]\n', 'utf-8');
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]\n', 'utf-8');
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '[]\n', 'utf-8');
}

function readJson(file) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8');
}

function normalizeLanguage(language) {
  const code = String(language || 'en').toLowerCase();
  return LANGUAGE_PACKS[code] ? code : 'en';
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((accumulator, pair) => {
    const [rawKey, ...rest] = pair.split('=');
    if (!rawKey) return accumulator;
    const key = rawKey.trim();
    if (!key) return accumulator;
    accumulator[key] = decodeURIComponent(rest.join('=').trim());
    return accumulator;
  }, {});
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createAccessToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '15m' });
}

function createRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

function getUserById(userId) {
  const users = readJson(USERS_FILE);
  return users.find((user) => user.id === userId) || null;
}

function setRefreshCookie(res, refreshToken) {
  res.setHeader('Set-Cookie', [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=${Math.floor(REFRESH_COOKIE_MAX_AGE_MS / 1000)}`
  ]);
}

function clearRefreshCookie(res) {
  res.setHeader('Set-Cookie', [`${REFRESH_COOKIE_NAME}=; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=0`]);
}

function createSession(userId) {
  const sessions = readJson(SESSIONS_FILE);
  const refreshToken = createRefreshToken();
  const now = Date.now();
  const session = {
    id: `SES-${now}`,
    userId,
    refreshTokenHash: hashToken(refreshToken),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + REFRESH_COOKIE_MAX_AGE_MS).toISOString(),
    revokedAt: null
  };

  sessions.unshift(session);
  writeJson(SESSIONS_FILE, sessions.slice(0, 2000));
  return { session, refreshToken };
}

function revokeAllUserSessions(userId) {
  const sessions = readJson(SESSIONS_FILE);
  let changed = false;

  for (const session of sessions) {
    if (session.userId === userId && !session.revokedAt) {
      session.revokedAt = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) writeJson(SESSIONS_FILE, sessions);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) return res.status(401).json({ success: false, message: 'Missing auth token' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (_err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

function normalizeText(text) {
  return (text || '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function quickExtractDetails(rawText) {
  const text = rawText || '';
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const cleanValue = (value) =>
    String(value || '')
      .replace(/^[\s:;\-–—]+/, '')
      .replace(/[\s,;]+$/, '')
      .trim();

  const isUsefulValue = (value) => {
    const cleaned = cleanValue(value);
    if (!cleaned) return false;
    if (/^(na|n\/?a|nil|none|not\s*available|not\s*found)$/i.test(cleaned)) return false;
    return cleaned.length >= 2;
  };

  const captureByLabel = (labelPattern) => {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const match = line.match(labelPattern);
      if (!match) continue;

      const sameLineValue = cleanValue(match[1] || '');
      if (isUsefulValue(sameLineValue)) return sameLineValue;

      const nextLine = cleanValue(lines[index + 1] || '');
      if (isUsefulValue(nextLine) && !/^(date|claim|policy|insurer|insurance|name|policyholder|insured)\b/i.test(nextLine)) {
        return nextLine;
      }
    }
    return null;
  };

  const captureByRegex = (regexes) => {
    for (const regex of regexes) {
      const match = text.match(regex);
      if (!match) continue;
      const value = cleanValue(match[1] || '');
      if (isUsefulValue(value)) return value;
    }
    return null;
  };

  const claimId =
    captureByLabel(/\b(?:claim\s*(?:id|no\.?|number|ref(?:erence)?\s*(?:id|no\.?|number)?|reference))\b\s*[:\-–—]?\s*(.*)$/i) ||
    captureByRegex([
      /\bclaim\s*(?:id|no\.?|number|ref(?:erence)?\s*(?:id|no\.?|number)?|reference)\b\s*[:\-–—]?\s*([^\n,;]+)/i,
      /\bclm[-\s]?(\d{3,}[a-z0-9\-\/]*)\b/i
    ]);

  const policyNumber =
    captureByLabel(/\b(?:policy\s*(?:no\.?|number|id|#|ref(?:erence)?\s*(?:no\.?|number)?|reference)|policy\s*#)\b\s*[:\-–—]?\s*(.*)$/i) ||
    captureByRegex([
      /\bpolicy\s*(?:no\.?|number|id|#|ref(?:erence)?\s*(?:no\.?|number)?|reference)\b\s*[:\-–—]?\s*([^\n,;]+)/i
    ]);

  const insurerName =
    captureByLabel(/\b(?:insurer|insurance\s*company|company|from)\b\s*[:\-–—]?\s*(.*)$/i) ||
    captureByRegex([
      /\b(?:insurer|insurance\s*company|from)\b\s*[:\-–—]?\s*([^\n]+)/i,
      /\b([A-Z][A-Za-z&.,\- ]{2,}(?:Insurance|Assurance)[A-Za-z&.,\- ]*)\b/
    ]);

  const claimantName =
    captureByLabel(/\b(?:claimant|insured\s*name|insured|policyholder|name\s*of\s*insured|member\s*name|patient\s*name|proposer\s*name|dear)\b\s*[:\-–—]?\s*(.*)$/i) ||
    captureByRegex([
      /\b(?:insured\s*name|policyholder|claimant|name\s*of\s*insured|member\s*name|patient\s*name|proposer\s*name|dear)\b\s*[:\-–—]?\s*([A-Za-z][A-Za-z .']{2,})/i
    ]);

  const denialDate =
    captureByLabel(/\b(?:denial\s*date|date\s*of\s*denial|date|issued\s*on)\b\s*[:\-–—]?\s*(.*)$/i) ||
    captureByRegex([
      /\b(?:denial\s*date|date\s*of\s*denial|date|issued\s*on)\b\s*[:\-–—]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})/i,
      /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})\b/
    ]);

  let claimType = 'general';
  const lower = text.toLowerCase();
  if (lower.includes('health') || lower.includes('hospital')) claimType = 'health';
  else if (lower.includes('motor') || lower.includes('vehicle') || lower.includes('car')) claimType = 'motor';
  else if (lower.includes('life')) claimType = 'life';
  else if (lower.includes('property') || lower.includes('home')) claimType = 'property';
  else if (lower.includes('crop')) claimType = 'crop';
  else if (lower.includes('travel')) claimType = 'travel';

  return {
    claimantName: claimantName || 'Policyholder',
    insurerName: insurerName || 'Insurance Company',
    claimId: claimId || 'Not found',
    policyNumber: policyNumber || 'Not found',
    claimType,
    denialDate: denialDate || 'Not found'
  };
}

function scoreExtractionConfidence(text, details, method, rawConfidence = null) {
  if (method === 'tesseract-ocr') {
    const confidence = Number.isFinite(rawConfidence) ? rawConfidence : 0;
    return Math.max(30, Math.min(99, Math.round(confidence)));
  }

  const fieldHits = ['claimantName', 'insurerName', 'claimId', 'policyNumber', 'denialDate'].filter((key) => details[key] && details[key] !== 'Not found').length;
  const lengthBonus = Math.min(12, Math.floor((text || '').length / 350));
  const base = method === 'pdf-parse' ? 72 : 68;
  return Math.max(45, Math.min(97, base + fieldHits * 5 + lengthBonus));
}

async function extractDenialText(file) {
  if (!file) {
    throw new Error('Please upload a denial letter file');
  }

  const mime = file.mimetype || '';
  const name = (file.originalname || '').toLowerCase();

  if (mime.includes('pdf') || name.endsWith('.pdf')) {
    const parser = new PDFParse({ data: file.buffer });
    try {
      const parsed = await parser.getText();
      const text = normalizeText(parsed.text);
      if (!text) throw new Error('No readable text found in PDF. Try a clearer PDF or image scan.');
      return { text, extractionMethod: 'pdf-parse', pageCount: parsed.total || parsed.pages?.length || null };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (mime.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(name)) {
    const result = await Tesseract.recognize(file.buffer, 'eng');
    const text = normalizeText(result.data.text);
    if (!text) throw new Error('OCR could not extract text from image.');
    return { text, extractionMethod: 'tesseract-ocr', ocrConfidence: result.data.confidence || 0 };
  }

  if (mime.includes('text') || name.endsWith('.txt')) {
    const text = normalizeText(file.buffer.toString('utf-8'));
    if (!text) throw new Error('Uploaded text file is empty.');
    return { text, extractionMethod: 'plain-text' };
  }

  throw new Error('Unsupported file type. Please upload PDF, image, or TXT.');
}

function buildLocalizedAppealLetter(language, analysis) {
  const pack = LANGUAGE_PACKS[normalizeLanguage(language)] || LANGUAGE_PACKS.en;
  const details = analysis.extractedDetails || {};
  const clauseAnalysis = Array.isArray(analysis.clauseAnalysis) ? analysis.clauseAnalysis : [];
  const recommendedActions = Array.isArray(analysis.recommendedActions) ? analysis.recommendedActions : [];
  const timeline = Array.isArray(analysis.appealTimeline) ? analysis.appealTimeline : [];

  const lines = [
    `${pack.dateLabel}: ${new Date().toLocaleDateString('en-IN')}`,
    '',
    pack.toLabel + ',',
    pack.officerLine,
    details.insurerName || 'Insurance Company',
    '',
    pack.subjectLine,
    '',
    pack.greeting,
    '',
    pack.intro.replace('{claimId}', details.claimId || 'Not found').replace('{policyNumber}', details.policyNumber || 'Not found'),
    pack.context,
    '',
    'Clause-level observations:'
  ];

  clauseAnalysis.forEach((clause, index) => {
    lines.push(`${index + 1}. ${clause.clauseRef}: ${clause.counterArgument}`);
  });

  if (recommendedActions.length) {
    lines.push('', 'Recommended actions:');
    recommendedActions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action}`);
    });
  }

  if (timeline.length) {
    lines.push('', 'Escalation timeline:');
    timeline.forEach((step) => {
      lines.push(`${step.day}: ${step.task}`);
    });
  }

  lines.push('', pack.request, pack.escalation, '', pack.closing, details.claimantName || 'Policyholder', details.email || '', details.phone || '');
  return lines.filter(Boolean).join('\n');
}

function formatDateRelative(baseDate, daysToAdd) {
  const safeBase = Number.isFinite(baseDate?.getTime?.()) ? baseDate : new Date();
  const result = new Date(safeBase.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  return result.toLocaleDateString('en-IN');
}

function hasTextMatch(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function estimateProviderPreparedness(denialText) {
  const text = String(denialText || '').toLowerCase();
  const evidenceSignals = [
    /clause\s*\d+/i,
    /section\s*\d+/i,
    /as per policy/i,
    /survey report/i,
    /medical opinion/i,
    /investigation/i,
    /documentary evidence/i,
    /timeline/i
  ];
  const weakSignals = [
    /without prejudice/i,
    /at our discretion/i,
    /general terms/i,
    /insufficient documents/i,
    /not admissible/i
  ];

  const evidenceHits = evidenceSignals.reduce((count, signal) => count + (signal.test(text) ? 1 : 0), 0);
  const weakHits = weakSignals.reduce((count, signal) => count + (signal.test(text) ? 1 : 0), 0);
  const lengthFactor = Math.min(10, Math.floor(text.length / 500));

  // Higher score means insurer denial appears more structured and documented.
  const rawScore = 42 + evidenceHits * 8 + lengthFactor - weakHits * 3;
  const score = Math.max(20, Math.min(96, rawScore));
  const level = score >= 75 ? 'High' : score >= 55 ? 'Medium' : 'Low';

  const signals = [];
  if (evidenceHits >= 4) signals.push('Denial references multiple evidentiary anchors (clause/report/timeline).');
  if (evidenceHits >= 2 && evidenceHits < 4) signals.push('Denial includes some policy-grounded reasoning elements.');
  if (weakHits >= 2) signals.push('Several broad or non-specific phrases reduce insurer preparedness quality.');
  if (!signals.length) signals.push('Preparedness score inferred from general structure and language density.');

  return {
    title: 'Provider preparedness score',
    score,
    level,
    signals
  };
}

function buildSupportPack(denialText, details, language, analysis) {
  const lowerText = denialText.toLowerCase();
  const claimType = details.claimType || 'general';
  const denialDate = new Date(details.denialDate);
  const rights = [
    'You can ask the insurer for a written, clause-wise reason for denial.',
    'You can submit additional documents and request a fresh internal review.',
    'You can escalate to the insurer grievance officer, Insurance Ombudsman, or IRDAI channels if the issue remains unresolved.'
  ];

  if (claimType === 'health') {
    rights.push('For health claims, ask for the exact policy clause, medical interpretation, and pre-auth or discharge note basis used in the denial.');
  } else if (claimType === 'motor') {
    rights.push('For motor claims, ask for the survey report basis, delay basis, and repair estimate comparison used in the rejection.');
  } else if (claimType === 'life') {
    rights.push('For life claims, ask for the non-disclosure or exclusion details together with the document trail relied upon.');
  }

  const missingDocs = [];
  const foundDocs = [];
  const docSignals = [
    { label: 'Hospital discharge summary', patterns: [/discharge summary/i, /discharge/i] },
    { label: 'Medical bills and receipts', patterns: [/bill/i, /receipt/i, /invoice/i] },
    { label: 'Policy copy', patterns: [/policy/i] },
    { label: 'Claim form', patterns: [/claim form/i] },
    { label: 'ID proof', patterns: [/aadhaar|pan|id proof/i] },
    { label: 'Accident / FIR / police report', patterns: [/fir|police|accident/i] },
    { label: 'Surveyor / garage estimate', patterns: [/survey/i, /garage/i, /estimate/i] },
    { label: 'Death certificate / nominee proof', patterns: [/death certificate/i, /nominee/i] }
  ];

  for (const doc of docSignals) {
    if (hasTextMatch(lowerText, doc.patterns)) foundDocs.push(doc.label);
    else missingDocs.push(doc.label);
  }

  const urgency = hasTextMatch(lowerText, [/urgent/i, /within 7 days/i, /within 15 days/i, /within 30 days/i, /time limit/i])
    ? 'High urgency: the denial letter already references a response timeline.'
    : 'Standard urgency: act quickly and preserve the date of receipt.';

  const deadlineTracker = [
    {
      label: 'Internal grievance',
      date: formatDateRelative(denialDate, 7),
      note: 'File a formal grievance and request written acknowledgement.'
    },
    {
      label: 'Follow-up reminder',
      date: formatDateRelative(denialDate, 15),
      note: 'Send a follow-up if no speaking order is received.'
    },
    {
      label: 'Escalation to senior grievance officer',
      date: formatDateRelative(denialDate, 30),
      note: 'Escalate with all evidence and case chronology.'
    },
    {
      label: 'Ombudsman / IRDAI escalation',
      date: formatDateRelative(denialDate, 45),
      note: 'Proceed if the insurer remains non-responsive or rejects without detail.'
    }
  ];

  const completeness = {
    status: missingDocs.length <= 3 ? 'Almost ready' : 'Needs follow-up documents',
    foundDocs,
    missingDocs: missingDocs.slice(0, 6),
    nextSteps: [
      'Collect the likely missing documents before filing the appeal.',
      'Scan all pages clearly and keep one master PDF copy.',
      'Match the date of each bill or report with the denial reason.'
    ]
  };

  const shortWhatsApp = `Hi, my insurance claim was denied for ${details.claimType} claim ${details.claimId}. The app identified the likely reason as ${analysis.clauseAnalysis?.[0]?.clauseRef || 'a clause issue'}. I need to file grievance and appeal before ${deadlineTracker[0].date}.`;
  const shortSms = `Claim ${details.claimId} denied. Appeal needed. Deadline: ${deadlineTracker[0].date}. Check ClaimShield for docs.`;
  const providerPreparedness = estimateProviderPreparedness(denialText);

  return {
    policyRights: {
      title: 'Policy-to-rights translator',
      plainSummary: 'This letter can be challenged if the insurer has not given a clear clause, reason, or evidence trail. You have the right to ask for a written explanation and escalation path.',
      rights
    },
    completenessChecklist: {
      title: 'Claim completeness checker',
      ...completeness
    },
    deadlineTracker: {
      title: 'Deadline and escalation tracker',
      urgency,
      steps: deadlineTracker
    },
    sharePack: {
      title: 'WhatsApp and SMS assistant',
      whatsapp: shortWhatsApp,
      sms: shortSms,
      familyBrief: `Claim ${details.claimId} needs an appeal. I have extracted the policy details and I am preparing the grievance draft by ${deadlineTracker[0].date}.`
    },
    voicePack: {
      title: 'Voice and regional language support',
      speakText: `${analysis.denialSummary || 'Insurance denial summary.'} ${rights.join(' ')}`,
      hint: 'Use the Speak button to read the summary aloud in your browser. You can also upload regional-language letters for analysis.'
    },
    providerPreparedness
  };
}

function buildAnalysisPayloadFromText(denialText, language, detailsOverride = null) {
  const details = detailsOverride || quickExtractDetails(denialText);
  const text = denialText.toLowerCase();
  const clauseAnalysis = [];

  if (/incomplete|missing|document|attachment|proof/.test(text)) {
    clauseAnalysis.push({
      clauseRef: 'Documentation and submission requirements',
      insurerInterpretation: 'Insurer says supporting documents were incomplete.',
      counterArgument: 'A complete evidence bundle with indexed attachments can cure this deficiency.',
      strength: 'medium'
    });
  }

  if (/pre-existing|waiting period|excluded|exclusion/.test(text)) {
    clauseAnalysis.push({
      clauseRef: 'Policy exclusion and waiting period terms',
      insurerInterpretation: 'Insurer mapped the claim under exclusion or waiting period.',
      counterArgument: 'Request specific clause citation and compare the denial with policy timelines and records.',
      strength: 'high'
    });
  }

  if (/delay|late|intimation/.test(text)) {
    clauseAnalysis.push({
      clauseRef: 'Notice and claim intimation timeline',
      insurerInterpretation: 'Claim was not intimated within the required period.',
      counterArgument: 'Provide communication logs and exceptional circumstances for delayed notice.',
      strength: 'medium'
    });
  }

  if (/fraud|misrepresentation|non-disclosure/.test(text)) {
    clauseAnalysis.push({
      clauseRef: 'Disclosure and representation terms',
      insurerInterpretation: 'Insurer alleges non-disclosure or mismatch.',
      counterArgument: 'Request the exact mismatch and evidence supporting the allegation before accepting the denial.',
      strength: 'high'
    });
  }

  if (!clauseAnalysis.length) {
    clauseAnalysis.push({
      clauseRef: 'General denial rationale',
      insurerInterpretation: 'Denial language is broad and non-specific.',
      counterArgument: 'Seek clause-level reason code and written justification.',
      strength: 'medium'
    });
  }

  const recommendedActions = [
    'Request a detailed reason code and specific clause citation from the insurer.',
    'Submit indexed supporting evidence with an acknowledgment receipt.',
    'Escalate to grievance redressal and Ombudsman channels if unresolved.'
  ];

  const appealTimeline = [
    { day: 'Day 0', task: 'Compile denial letter, policy, and all supporting proofs.' },
    { day: 'Day 1-2', task: 'File structured internal grievance appeal.' },
    { day: 'Day 7-15', task: 'Follow up for a written speaking order.' },
    { day: 'Day 16-30', task: 'Escalate to the grievance officer with the full chronology.' },
    { day: 'After 30 days', task: 'Escalate to Insurance Ombudsman / IRDAI channels.' }
  ];

  return {
    language: normalizeLanguage(language),
    extractedDetails: details,
    denialSummary: 'Automated summary generated from the denial letter after document parsing.',
    clauseAnalysis,
    recommendedActions,
    appealTimeline,
    confidenceScore: 62,
    llmUsed: false,
    provider: 'fallback',
    note: 'OPENAI_API_KEY missing or unavailable, so fallback legal reasoning was used.'
  };
}

async function callOpenAIForLegalAnalysis(denialText, language = 'en') {
  if (!OPENAI_API_KEY || LLM_PROVIDER !== 'openai') {
    return buildAnalysisPayloadFromText(denialText, language);
  }

  const normalizedLanguage = normalizeLanguage(language);
  const details = quickExtractDetails(denialText);
  const systemPrompt = [
    'You are a legal-tech insurance appeal analyst for Indian insurance denials.',
    'Extract all possible structured fields only from the denial letter text. Do not ask the user questions.',
    'Provide clause-level legal reasoning, risk score, and a ready-to-submit appeal letter.',
    'Return ONLY valid JSON with this schema:',
    '{',
    '  "language": string,',
    '  "extractedDetails": {',
    '    "claimantName": string,',
    '    "insurerName": string,',
    '    "claimId": string,',
    '    "policyNumber": string,',
    '    "claimType": "health"|"motor"|"life"|"property"|"crop"|"travel"|"general",',
    '    "denialDate": string',
    '  },',
    '  "denialSummary": string,',
    '  "clauseAnalysis": [{',
    '    "clauseRef": string,',
    '    "insurerInterpretation": string,',
    '    "counterArgument": string,',
    '    "strength": "low"|"medium"|"high"',
    '  }],',
    '  "recommendedActions": string[],',
    '  "appealTimeline": [{"day": string, "task": string}],',
    '  "appealLetter": string,',
    '  "confidenceScore": number',
    '}',
    'All narrative text must be in requested language code: ' + normalizedLanguage + '.',
    'If some fields are not present, use "Not found" and continue.'
  ].join('\n');

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: denialText.slice(0, 18000) }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API request failed with status ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty LLM response');

    const parsed = JSON.parse(content);
    parsed.language = normalizeLanguage(parsed.language || normalizedLanguage);
    parsed.extractedDetails = parsed.extractedDetails || details;
    parsed.clauseAnalysis = Array.isArray(parsed.clauseAnalysis) ? parsed.clauseAnalysis : [];
    parsed.recommendedActions = Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions : [];
    parsed.appealTimeline = Array.isArray(parsed.appealTimeline) ? parsed.appealTimeline : [];
    parsed.llmUsed = true;
    parsed.provider = 'openai';
    return parsed;
  } catch (_error) {
    return buildAnalysisPayloadFromText(denialText, normalizedLanguage, details);
  }
}

function buildAuthResponse(res, user) {
  const accessToken = createAccessToken(user);
  const { refreshToken } = createSession(user.id);
  setRefreshCookie(res, refreshToken);
  return { accessToken, user: { id: user.id, name: user.name, email: user.email } };
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const users = readJson(USERS_FILE);
    const existing = users.find((user) => user.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: `USR-${Date.now()}`,
      name,
      email,
      passwordHash,
      createdAt: new Date().toISOString()
    };

    users.push(user);
    writeJson(USERS_FILE, users);

    const auth = buildAuthResponse(res, user);
    return res.status(201).json({ success: true, ...auth });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Register failed', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const users = readJson(USERS_FILE);
    const user = users.find((entry) => entry.email.toLowerCase() === email.toLowerCase());
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

    const auth = buildAuthResponse(res, user);
    return res.json({ success: true, ...auth });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Login failed', error: error.message });
  }
});

app.post('/api/auth/refresh', (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const refreshToken = cookies[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'No refresh session found.' });
    }

    const sessions = readJson(SESSIONS_FILE);
    const tokenHash = hashToken(refreshToken);
    const session = sessions.find((entry) => entry.refreshTokenHash === tokenHash && !entry.revokedAt && new Date(entry.expiresAt).getTime() > Date.now());

    if (!session) {
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: 'Session expired or revoked.' });
    }

    const user = getUserById(session.userId);
    if (!user) {
      clearRefreshCookie(res);
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    session.expiresAt = new Date(Date.now() + REFRESH_COOKIE_MAX_AGE_MS).toISOString();
    writeJson(SESSIONS_FILE, sessions);
    setRefreshCookie(res, refreshToken);

    return res.json({ success: true, accessToken: createAccessToken(user), user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Refresh failed', error: error.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const refreshToken = cookies[REFRESH_COOKIE_NAME];
    let userId = null;

    if (refreshToken) {
      const sessions = readJson(SESSIONS_FILE);
      const tokenHash = hashToken(refreshToken);
      const session = sessions.find((entry) => entry.refreshTokenHash === tokenHash && !entry.revokedAt);
      if (session) {
        session.revokedAt = new Date().toISOString();
        userId = session.userId;
        writeJson(SESSIONS_FILE, sessions);
      }
    }

    if (!userId) {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (token) {
        try {
          const payload = jwt.verify(token, JWT_SECRET);
          userId = payload.id;
        } catch (_err) {
          userId = null;
        }
      }
    }

    if (userId) revokeAllUserSessions(userId);
    clearRefreshCookie(res);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Logout failed', error: error.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/analyze-letter', authMiddleware, upload.single('denialLetter'), async (req, res) => {
  try {
    const language = normalizeLanguage(req.body.language || 'en');
    const extracted = await extractDenialText(req.file);
    const denialText = extracted.text;
    const details = quickExtractDetails(denialText);
    const analysis = await callOpenAIForLegalAnalysis(denialText, language);
    const supportPack = buildSupportPack(denialText, details, language, analysis);

    analysis.language = normalizeLanguage(analysis.language || language);
    analysis.extractedDetails = analysis.extractedDetails || details;
    analysis.appealLetter = buildLocalizedAppealLetter(language, analysis);
    analysis.supportPack = supportPack;

    const extractionConfidence = scoreExtractionConfidence(denialText, details, extracted.extractionMethod, extracted.ocrConfidence || null);

    return res.json({
      success: true,
      extractionMethod: extracted.extractionMethod,
      extractionConfidence,
      fileInfo: {
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        pageCount: extracted.pageCount || null
      },
      extractedTextPreview: denialText.slice(0, 1600),
      extractedDetails: details,
      analysis,
      supportPack
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/cases', authMiddleware, (req, res) => {
  try {
    const cases = readJson(CASES_FILE);
    const record = {
      id: `CS-${Date.now()}`,
      userId: req.user.id,
      createdAt: new Date().toISOString(),
      status: req.body.status || 'Appeal Drafted',
      ...req.body
    };

    cases.unshift(record);
    writeJson(CASES_FILE, cases.slice(0, 2000));

    return res.status(201).json({ success: true, case: record });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not save case', error: error.message });
  }
});

app.get('/api/cases', authMiddleware, (req, res) => {
  try {
    const cases = readJson(CASES_FILE).filter((entry) => entry.userId === req.user.id);
    return res.json({ success: true, cases });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not load cases', error: error.message });
  }
});

app.get('/api/case-patterns', authMiddleware, (req, res) => {
  try {
    const cases = readJson(CASES_FILE);

    const claimTypeCounts = {};
    const clauseCounts = {};
    const missingDocCounts = {};
    let confidenceTotal = 0;
    let confidenceCount = 0;

    for (const record of cases) {
      const claimType = String(record?.extractedDetails?.claimType || 'general').toLowerCase();
      claimTypeCounts[claimType] = (claimTypeCounts[claimType] || 0) + 1;

      const clauses = Array.isArray(record?.clauseAnalysis) ? record.clauseAnalysis : [];
      for (const clause of clauses.slice(0, 3)) {
        const ref = String(clause?.clauseRef || 'General denial rationale');
        clauseCounts[ref] = (clauseCounts[ref] || 0) + 1;
      }

      const missingDocs = record?.supportPack?.completenessChecklist?.missingDocs || [];
      for (const doc of missingDocs) {
        const key = String(doc);
        if (!key) continue;
        missingDocCounts[key] = (missingDocCounts[key] || 0) + 1;
      }

      const score = Number(record?.confidenceScore);
      if (Number.isFinite(score)) {
        confidenceTotal += score;
        confidenceCount += 1;
      }
    }

    const top = (bucket, limit) =>
      Object.entries(bucket)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([label, count]) => ({ label, count }));

    return res.json({
      success: true,
      patterns: {
        totalCases: cases.length,
        generatedAt: new Date().toISOString(),
        claimTypeDistribution: top(claimTypeCounts, 6),
        topDenialPatterns: top(clauseCounts, 6),
        topMissingDocuments: top(missingDocCounts, 6),
        averageAnalysisConfidence: confidenceCount ? Math.round(confidenceTotal / confidenceCount) : null,
        privacyNote: 'Anonymized aggregate trends only. No claimant names, emails, phone numbers, or IDs are exposed.'
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not build anonymized case patterns', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`ClaimShield running at http://localhost:${PORT}`);
});
