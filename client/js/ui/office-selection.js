// Which office is selected in the 사무실 tab (the one the camera went to). The staff tab lists only its employees.
const LOCAL = 'local';
let selected = LOCAL;
const listeners = new Set();

export const selectedOffice = () => selected;
export const onOfficeChange = listener => listeners.add(listener);

export function selectOffice(id) {
  if (id === selected) return;
  selected = id;
  listeners.forEach(listener => listener(id));
}

// back to the local office when the selected one has no sessions left
export function keepSelectionIn(officeIds) {
  if (!officeIds.includes(selected)) selectOffice(LOCAL);
}

export const officeOf = session => session.workspace?.id ?? LOCAL;
