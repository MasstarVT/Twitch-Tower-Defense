'use strict';
const tmi = require('tmi.js');

/**
 * Twitch chat client. Anonymous (read-only) unless TWITCH_BOT_USERNAME + TWITCH_OAUTH are set.
 * onMessage({ login, name, message, isMod, isBroadcaster })
 */
function connect({ channel, username, oauth }, onMessage) {
  if (!channel) {
    console.warn('[twitch] TWITCH_CHANNEL not set; chat disabled (use the dev chat box in the control panel).');
    return { canSay: false, say: () => {} };
  }
  const authed = !!(username && oauth);
  const opts = {
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    channels: [channel],
  };
  if (authed) opts.identity = { username, password: oauth.startsWith('oauth:') ? oauth : 'oauth:' + oauth };
  const client = new tmi.Client(opts);

  client.on('connected', () => console.log('[twitch] connected to #' + channel + ' (' + (authed ? 'bot ' + username : 'read-only') + ')'));
  client.on('disconnected', (r) => console.warn('[twitch] disconnected:', r));
  client.on('message', (ch, tags, message, self) => {
    if (self) return;
    onMessage({
      login: tags.username,
      name: tags['display-name'] || tags.username,
      message,
      isMod: !!tags.mod,
      isBroadcaster: !!(tags.badges && tags.badges.broadcaster),
    });
  });
  client.connect().catch((e) => console.error('[twitch] connect failed:', e.message));

  return {
    canSay: authed,
    say: (text) => { if (authed) client.say(channel, text).catch(() => {}); },
  };
}

module.exports = { connect };
