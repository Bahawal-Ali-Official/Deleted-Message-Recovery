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

// --- FEATURE SETUP ---
const messageStore = new Map();
// ▼▼▼ YAHAN APNA PERSONAL NUMBER LIKHEIN (COUNTRY CODE KE SAATH) ▼▼▼
const OWNER_JID = 'YOUR_NUMBER_HERE@s.whatsapp.net'; // Example: '923001234567@s.whatsapp.net'

//======================================================================//
//                  DELETED MESSAGE PROCESSOR FUNCTION                  //
//======================================================================//
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

        try {
            const buffer = await downloadMediaMessage(deletedMsg, 'buffer', {});
            let mediaMessage = {};
            if (deletedMsg.message.imageMessage) mediaMessage = { image: buffer, caption: "Deleted Image" };
            else if (deletedMsg.message.videoMessage) mediaMessage = { video: buffer, caption: "Deleted Video" };
            else if (deletedMsg.message.audioMessage) mediaMessage = { audio: buffer, mimetype: 'audio/mp4' };
            else if (deletedMsg.message.stickerMessage) mediaMessage = { sticker: buffer };
            else if (deletedMsg.message.documentMessage) mediaMessage = { document: buffer, mimetype: deletedMsg.message.documentMessage.mimetype, fileName: deletedMsg.message.documentMessage.fileName || "Deleted Document" };
            
            if (Object.keys(mediaMessage).length > 0) await sock.sendMessage(OWNER_JID, mediaMessage);
        } catch (e) { /* No media to download */ }
    } catch (e) {
        console.log(`Failed to process a deleted message: ${e.message}`);
    }
}

//======================================================================//
//                   EDITED MESSAGE PROCESSOR FUNCTION                  //
//======================================================================//
async function processSingleEditedMessage(sock, editEventMessage, originalMsgContent, newText) {
    try {
        const remoteJid = editEventMessage.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        const senderName = editEventMessage.pushName || 'Unknown User';

        let location = 'Personal Chat';
        if (isGroup) {
            try {
                const groupMeta = await sock.groupMetadata(remoteJid);
                location = `Group "${groupMeta.subject}"`;
            } catch (e) { location = "Unknown Group"; }
        }

        const originalContentText = originalMsgContent || "_(Original message not found in bot's memory)_";
        
        const notification = `*✏️ Message Edited ✏️*\n\n` +
                             `*👤 User:* ${senderName}\n` +
                             `*📍 Location:* ${location}\n` +
                             `*⏰ Time:* ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}\n\n` +
                             `*--- Original Message ---*\n${originalContentText}\n\n` +
                             `*--- Edited Message ---*\n${newText}`;

        await sock.sendMessage(OWNER_JID, { text: notification });
    } catch (e) {
        console.log(`Failed to process an edited message: ${e.message}`);
    }
}

//======================================================================//
//                         MAIN BOT FUNCTION                            //
//======================================================================//
async function startBot() {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using Baileys version v${version.join('.')}, isLatest: ${isLatest}`);

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({ version, logger, auth: state });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('------------------------------------------------');
            qrcode.generate(qr, { small: true });
            console.log('------------------------------------------------');
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('Connection opened! Bot is online. ✅');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- HANDLE NEW AND EDITED MESSAGES (UPSERT) ---
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        
        // --- DEBUGGING LINE ---
        // Yeh line har naye event ka poora data console mein print karegi.
        console.log('[UPSERT EVENT DATA]:', JSON.stringify(message, null, 2));

        if (!message.message || message.key.fromMe) return;

        const protocolMessage = message.message.protocolMessage;
        // **FIX**: Ab hum 'editedMessage' ke hone ya na hone par check kar rahe hain.
        if (protocolMessage && protocolMessage.editedMessage) {
            const originalMsgId = protocolMessage.key.id;
            const originalMsg = messageStore.get(originalMsgId);
            const newText = protocolMessage.editedMessage.conversation;

            if (newText && originalMsg) {
                const originalContent = originalMsg.message?.conversation || originalMsg.message?.extendedTextMessage?.text;
                await processSingleEditedMessage(sock, message, originalContent, newText);
                
                originalMsg.message.conversation = newText;
                messageStore.set(originalMsgId, originalMsg);
            }
            return;
        }
        
        const id = message.key.id;
        if (!messageStore.has(id)) {
             messageStore.set(id, message);
             setTimeout(() => {
                 if (messageStore.has(id)) messageStore.delete(id);
             }, 60 * 60 * 1000);
        }
    });

    // --- HANDLE DELETED MESSAGES (UPDATE) ---
    sock.ev.on('messages.update', async (updates) => {
        for (const { key, update } of updates) {
            if (update.message === null) {
                const deletedMsg = messageStore.get(key.id);
                if (deletedMsg) {
                    await processSingleDeletedMessage(sock, deletedMsg);
                    messageStore.delete(key.id);
                }
            }
        }
    });

    return sock;
}

startBot().catch(err => {
    console.error("Error starting bot:", err);
});
