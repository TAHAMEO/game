/**
 * THE QUIET — the story.
 *
 * St. Ashgrove General. In 1976 Dr. Elias Hale opened the Quiet Ward in the Old Wing: the
 * Silence Protocol, graduated isolation in an anechoic chamber for patients who heard
 * voices. Patient 4 was Ada Wren, nine years old, who said she did not hear a voice — she
 * heard something listening. On 14 October 1979 a storm took the power during her
 * thirty-first session. The Quiet Room's door is held by a magnet; without power it would
 * not open. They opened it forty-one hours later. The room was empty.
 *
 * Tonight the storm is back and the power is out. You are on the night shift. You do not
 * remember coming in. Every life is someone new; the Entity remembers every one of them;
 * the notebook fills with handwriting that is almost yours. The case file explains why.
 *
 * Nothing here changes the simulation: it is words, delivered by `story.ts`.
 */

export interface CaseFile {
  id: number;
  title: string;
  /** `{name}` is replaced with the reader's name. */
  text: string;
}

export const CASE_FILES: readonly CaseFile[] = [
  {
    id: 0,
    title: 'Admission — Patient 4',
    text:
      'WREN, Ada. Age 9. Referred for "auditory phenomena". Mother reports the child stops talking for hours at a time "to listen to something". ' +
      'Asked what she hears, the child says: "It isn\'t a voice. It\'s an ear." Admitted to the Quiet Ward under Dr. E. Hale. Bed 4.',
  },
  {
    id: 1,
    title: 'The Silence Protocol — proposal, Dr. E. Hale',
    text:
      'The voices our patients hear are noise in want of a listener. Remove every sound, and the noise has nothing left to answer. ' +
      'I propose graduated isolation in an anechoic chamber — the Quiet Room — beginning at ten minutes and extending as tolerated. ' +
      '[Stamped: APPROVED. Budget line 31.]',
  },
  {
    id: 2,
    title: 'Session log — Patient 4, sessions 1 to 12',
    text:
      'S3: subject reports the room "is not empty". S7: subject draws a tall figure with its head tipped to one side. Asked what it is doing, ' +
      'she says "listening for me". S12: subject holds her breath for long periods. Explains that if it cannot hear her, it cannot find her. ' +
      'Recommend extending sessions.',
  },
  {
    id: 3,
    title: 'Letter, never posted — from Mrs. J. Wren',
    text:
      'Doctor, she won\'t sleep with the light off and she won\'t sleep with it on. She says it likes it when you look for it. She says it learns. ' +
      'I signed your forms because you said quiet would help her. She was never this quiet before. I want her home.',
  },
  {
    id: 4,
    title: 'Night report — Nurse R. Calloway, 14 Oct 1979',
    text:
      'Storm took the mains at 03:12. Generator did not start. Pt 4 was in session. The Quiet Room door is held by a magnet and will not open without power. ' +
      'I could hear nothing through the door, which is the point of the door. Dr. Hale said do not force it, the session is valuable. ' +
      'I sat outside it until morning. I want it written down that I sat outside it.',
  },
  {
    id: 5,
    title: 'Transcript — Quiet Room recorder, session 31',
    text:
      '[00:00:00 – 39:12:40] no signal.  [39:12:41] a single inhalation, very close to the microphone. Not the subject: her channel is flat. ' +
      '[39:12:43 – 41:02:00] no signal.  Door opened 41:02. Room empty. Bed 4 made, and cold.',
  },
  {
    id: 6,
    title: 'Memo — Administration, November 1979',
    text:
      'Following the disappearance of Patient 4 the Old Wing is SEALED BY ORDER pending inquiry. Staff are reminded that the Quiet Ward did not exist. ' +
      'Do not discuss with press or family. Do not discuss among yourselves. If you hear anything in the Old Wing, you did not.',
  },
  {
    id: 7,
    title: 'Staff-room noticeboard (torn)',
    text:
      'MISSING — R. Calloway (nights). Last seen Old Wing corridor. If found, do not let her talk about the room.  MISSING — T. Ibsen (porter).  ' +
      'MISSING — M. Okonjo.  MISSING —  MISSING —  [the list runs off the paper]  Whoever keeps moving the fuses: STOP IT.',
  },
  {
    id: 8,
    title: 'Dr. Hale — private notes',
    text:
      'It was never in her. It was in the room — in what we made when we took every sound away. Silence is not empty. Silence is an ear. ' +
      'She fed it the only thing she had: the effort of keeping still. Now it is out, and it knows the shape of everyone who ever hid from it.',
  },
  {
    id: 9,
    title: 'Child\'s drawing, crayon — written on the back',
    text:
      'The hospital drawn as a box with a hundred windows and a tall shape in every one. Underneath, in big careful letters: ' +
      'EVERY TIME SOMEONE DIES IN HERE THEY COME BACK AS SOMEONE ELSE. IT REMEMBERS ALL OF THEM. I COUNTED TO FOUR.',
  },
  {
    id: 10,
    title: 'Admission — no patient number',
    text:
      'Name: {name}. Date: tonight. Referred for: auditory phenomena. Patient insists, calmly and repeatedly, "I work here." ' +
      'Patient reports something in the building that listens with its whole head. Admitted to the Quiet Ward. Bed 4.',
  },
  {
    id: 11,
    title: 'Dr. Hale — last entry',
    text:
      'Session 1,140. She still believes she is the night staff. Tonight a porter, last night a nurse, tomorrow the chaplain. ' +
      'Each time it catches her she wakes as someone new and the night begins again. The listener is the part of her that stayed in the room. ' +
      'If she ever reaches the gate knowing who she is, perhaps she will wake. — E.H.',
  },
];

export interface VisionDef {
  id: string;
  /** Zone key that triggers it on first entry in a run. */
  zone: string;
  /** Plays once ever (persisted), instead of now and then. */
  once: boolean;
  /** Case-file pages needed before it can happen. */
  minPages: number;
  duration: number;
  lines: string[];
}

/**
 * Story visions: hallucinated memories that belong to the building (and to whoever is
 * really dreaming it). The presentation layer stages each one; the Entity notices nothing.
 */
export const VISIONS: readonly VisionDef[] = [
  {
    id: 'oldwing',
    zone: 'o',
    once: true,
    minPages: 0,
    duration: 9,
    lines: ['The lights are on. It is 1979. A nurse is singing behind a curtain.', '"Session thirty-one, Ada. It\'ll be quiet this time."', 'A child\'s voice: "It\'s not quiet in there. It\'s listening."'],
  },
  {
    id: 'morgue',
    zone: 'g',
    once: false,
    minPages: 1,
    duration: 7,
    lines: ['Drawer four knocks. Three times. Then once more.', 'A small voice through the steel: "You left me in the quiet."'],
  },
  {
    id: 'garden',
    zone: 'c',
    once: false,
    minPages: 0,
    duration: 7,
    lines: ['The chapel bell rings once. Nobody has climbed to the bell in twenty years.', 'Under the rain, a hymn, sung backwards.'],
  },
  {
    id: 'surgery',
    zone: 'u',
    once: false,
    minPages: 2,
    duration: 7,
    lines: ['The operating lamp swings on its own.', 'Under it, chalked on the tiles, an outline the size of a child.'],
  },
  {
    id: 'security',
    zone: 's',
    once: true,
    minPages: 3,
    duration: 8,
    lines: ['Every monitor wakes at once. CAMERA 4 — QUIET ROOM.', 'Someone is standing in the corner with their head tipped to one side.', 'It is facing the camera. It is facing you.'],
  },
  {
    id: 'maintenance',
    zone: 'm',
    once: false,
    minPages: 4,
    duration: 7,
    lines: ['The dead PA system clicks on.', '"Doctor Hale to the Quiet Room. Doctor Hale to the Quiet Room."'],
  },
  {
    id: 'eastward',
    zone: 'e',
    once: false,
    minPages: 0,
    duration: 6,
    lines: ['Somewhere down the ward a music box is playing.', 'It stops the moment you listen for it.'],
  },
  {
    id: 'westward',
    zone: 'w',
    once: false,
    minPages: 0,
    duration: 6,
    lines: ['The phone at the nurses\' station is ringing.', 'When you reach it, there is only breathing on the line. Your own.'],
  },
  {
    id: 'nest',
    zone: 'n',
    once: true,
    minPages: 0,
    duration: 9,
    lines: ['Names are scratched into the plaster, hundreds of them.', '{names}', 'The newest one is still wet. It is in your handwriting.'],
  },
];

/** Things it says, close to your ear, when the building has been quiet too long. */
export const WHISPERS: readonly string[] = [
  '…four…',
  'be quiet now',
  'it can hear you thinking',
  'Ada?',
  'don\'t breathe',
  'session\'s over',
  'you work here',
  'it likes it when you look for it',
  'count to four',
  'Ruth sat outside the door all night',
  'you came back',
  'hold still',
];

/** Graffiti that turns up on the walls, more of it the more you know. */
export const WALL_WRITINGS: readonly { text: string; minPages: number }[] = [
  { text: 'IT HEARS YOU', minPages: 0 },
  { text: 'HOLD YOUR BREATH', minPages: 0 },
  { text: "DON'T LOOK FOR IT", minPages: 0 },
  { text: 'WHO IS LISTENING', minPages: 0 },
  { text: '4', minPages: 0 },
  { text: '||||  ||||  ||||  ||', minPages: 0 },
  { text: 'COUNT TO FOUR', minPages: 2 },
  { text: 'ADA', minPages: 3 },
  { text: 'SHE IS STILL IN THE QUIET ROOM', minPages: 5 },
  { text: 'YOU WORK HERE', minPages: 7 },
  { text: 'EVERY ONE OF US IS HER', minPages: 9 },
  { text: 'WAKE UP', minPages: 11 },
];

export function introLines(names: string[], runs: number, pages: number, total: number): string[] {
  const you = names.length === 1 ? `You are ${names[0]}.` : `You are ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;
  if (runs <= 1) {
    return [
      'ST. ASHGROVE GENERAL — 3:12 a.m.',
      'The storm took the power. The generator did not start.',
      'They told you the Old Wing was sealed in 1979. They told you a lot of things.',
      you,
      names.length === 1 ? 'You have worked nights here for years. You do not remember coming in tonight.' : 'You came in together. None of you remembers coming in.',
    ];
  }
  let feeling: string;
  if (pages >= total) feeling = 'You know your name. Your real one. Do you?';
  else if (pages >= 9) feeling = 'You know what is in the Quiet Room. You know who.';
  else if (pages >= 5) feeling = 'The case file is heavier than it should be.';
  else if (pages >= 1) feeling = 'Someone has been writing in your notebook. The handwriting is almost yours.';
  else feeling = 'You have the feeling you have done this before.';
  return ['3:12 a.m. Again.', you, feeling];
}

export interface Ending {
  title: string;
  lines: string[];
  trueEnding: boolean;
}

export function endingFor(outcome: 'dead' | 'escaped', name: string, cause: string, pages: number, total: number): Ending {
  if (outcome === 'dead') {
    const lines = [`${name}. ${cause}`, 'Somewhere in the Old Wing, the pile is a little higher.'];
    if (pages >= 9) lines.push('And somewhere, a girl holds her breath and becomes someone else.');
    return { title: 'It kept you.', lines, trueEnding: false };
  }
  if (pages >= total) {
    return {
      title: 'Session\'s over.',
      trueEnding: true,
      lines: [
        'The gate gives. Beyond it there is no car park and no rain — only a white corridor, and a door with a small square window.',
        'Through the window: a girl sitting very still in an empty room, holding her breath.',
        'You know her name. You have always known it.',
        '"Ada," says a voice on the other side of the glass. "Session\'s over. You can make a sound now."',
        'You open your mouth.',
      ],
    };
  }
  if (pages >= 9) {
    return {
      title: 'You got out.',
      trueEnding: false,
      lines: ['The paramedic\'s badge says HALE.', '"Same time tomorrow," he says, and the doors close.', 'There are pages of the case file you never found.'],
    };
  }
  if (pages >= 4) {
    return {
      title: 'You got out.',
      trueEnding: false,
      lines: [
        'In the ambulance you realise you never told them your name, and they never asked.',
        'The radio plays static. Under it, very faintly, someone is counting to four.',
      ],
    };
  }
  return {
    title: 'You got out.',
    trueEnding: false,
    lines: [
      'The rain is real, and cold. Behind you every window of St. Ashgrove is dark —',
      'except one, high in the Old Wing, where something stands with its head tilted.',
      'It will remember how.',
    ],
  };
}
