// Colors shared by the room and the characters, plus a stable hash so a session keeps its look.
export const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
export const SHIRT = [0xd9534f, 0x5bc0de, 0x5cb85c, 0xf0ad4e, 0x9b59b6, 0x34495e, 0xe67e22, 0x1abc9c];
export const HAIR = [0x222222, 0x6b4423, 0xd4a017, 0x999999];
export const CHAIR = [0xe76f51, 0x2a9d8f, 0xe9c46a, 0x264653, 0xf4a261, 0x8ab17d];
export const POD_RUG = [0x9fb4d9, 0xe8b4a0, 0x9fd0c8, 0xc5d6a8];
export const BEANBAG = [0xe76f51, 0x2a9d8f, 0x9b59b6];
export const CLAUDE_ORANGE = 0xd97757;
export const VISITOR_SHIRT = 0x3b6fd8;

// What an idle worker holds at each hangout activity (no entry = empty hands)
export const HELD_ITEM = { water: 0x9fd8ff, coffee: 0xffffff, snack: 0xf0ad4e, sit: 0xffffff, sofa: 0x9fd8ff, fridge: 0xd9534f, pingpong: 0xd9534f, beanbag: 0x9fd8ff };

export const hash = text => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
