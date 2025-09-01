//index.js

import { Boom } from '@hapi/boom';
import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadMediaMessage 
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const logger = pino({ level: 'info' });

// --- ANTI-DELETE FEATURE SETUP ---
const messageStore = new Map();
const OWNER_JID = 'YOUR_NUMBER_HERE@s.whatsapp.net'; // Yahan apna personal number likhein

/**
 * Yeh naya function sirf ek delete kiye gaye message ko process karega.
 * @param {any} sock - The bot socket
 * @param {any} deletedMsg - The deleted message object from the store
 */
async function processSingleDeletedMessage(sock, deletedMsg) {
    try {
        const remoteJid = deletedMsg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        const senderName = deletedMsg.pushName || 'Unknown User';

        let location = 'Personal Chat';
        if (isGroup) {
            try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                location = `Group "${groupMeta.subject}"`;
            } catch (e) { location = "Unknown Group"; }
        }
        
        const deletedContent = deletedMsg.message?.conversation || deletedMsg.message?.extendedTextMessage?.text || "_(Media or Non-text message)_";
        const notification = `*🗑️ Message Deleted 🗑️*\n\n` +
                             `*👤 User:* ${senderName}\n` +
                             `*📍 Location:* ${location}\n` +
                             `*⏰ Time:* ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}\n` +
                             `*📜 Deleted Message:*\n${deletedContent}`;

        await sock.sendMessage(OWNER_JID, { text: notification });

        const buffer = await downloadMediaMessage(deletedMsg, 'buffer', {});
        let mediaMessage = {};
        if (deletedMsg.message.imageMessage) {
            mediaMessage = { image: buffer, caption: "Deleted Image" };
        } else if (deletedMsg.message.videoMessage) {
            mediaMessage = { video: buffer, caption: "Deleted Video" };
        } else if (deletedMsg.message.audioMessage) {
            mediaMessage = { audio: buffer, mimetype: 'audio/mp4' };
        } else if (deletedMsg.message.stickerMessage) {
            mediaMessage = { sticker: buffer };
        } else if (deletedMsg.message.documentMessage) {
             mediaMessage = { document: buffer, mimetype: deletedMsg.message.documentMessage.mimetype, fileName: deletedMsg.message.documentMessage.fileName || "Deleted Document" };
        }
        if (Object.keys(mediaMessage).length > 0) {
            await sock.sendMessage(OWNER_JID, mediaMessage);
        }
    } catch (e) {
        console.log(`Failed to process a deleted message: ${e.message}`);
    }
}


async function startBot() {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Baileys version v${version.join('.')} istemal ho raha hai, isLatest: ${isLatest}`);

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        version,
        logger,
        auth: state,
        shouldIgnoreJid: jid => typeof jid === 'string' && jid.includes('@broadcast'),
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('------------------------------------------------');
            console.log('QR code mil gaya hai, apnay phone se scan karein:');
            qrcode.generate(qr, { small: true });
            console.log('------------------------------------------------');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) &&
                                     lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection band ho gaya hai: ', lastDisconnect.error, ', dobara connect kar rahe hain: ', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('Connection open ho gaya hai! Bot online hai. ✅');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        if (!message.message || message.key.fromMe) return;

        const id = message.key.id;
        messageStore.set(id, message);
        setTimeout(() => {
            if (messageStore.has(id)) messageStore.delete(id);
        }, 60 * 60 * 1000);
    });

    // --- DELETED MESSAGES KO HANDLE KARNA (Updated Logic) ---
    sock.ev.on('messages.update', async (updates) => {
        const processingPromises = [];

        for (const { key, update } of updates) {
            if (update.message === null) {
                const deletedMsg = messageStore.get(key.id);
                if (deletedMsg) {
                    // Har deleted message ko process karne ka promise shuru karein aur array mein daalein
                    processingPromises.push(processSingleDeletedMessage(sock, deletedMsg));
                    // Foran store se delete karein taake dobara process na ho
                    messageStore.delete(key.id);
                }
            }
        }
        
        // Sab promises ke poora hone ka intezar karein
        await Promise.all(processingPromises);
    });

    return sock;
}

startBot().catch(err => {
    console.error("Bot start karne mein error:", err);
});
