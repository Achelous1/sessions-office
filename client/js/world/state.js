// State shared across the office modules.

// session id -> Desk: { id, session, slot, group, screen, worker, label, bubble, bubbleUntil, questionMark, clawds, ... }
export const desks = new Map();

// meshes that open their session's chat when clicked (mesh.userData.sid = session id)
export const clickables = [];

// sessions fired from the staff list: they cry on the way out instead of just leaving
export const firedIds = new Set();
