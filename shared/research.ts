export const research = {
  checked: '18 October 2026',
  disclaimer: 'Independent, unofficial practice. Not affiliated with ICT-Berufsbildung Schweiz, ICTskills or SwissSkills. Generated briefs, points, tests and time limits are training choices, not official tasks or predictions.',
  stack: 'This trainer uses React / TypeScript, Node.js and SQLite. The published national Skill 09 overview specifies Java or .NET. Practise the same business rules in that stack too, and follow your organiser’s final instructions.',
  sources: [
    {
      title: 'ICT-Berufsbildung Schweiz — competition overview',
      url: 'https://www.ict-berufsbildung.ch/grundbildung/berufsmeisterschaft/',
      type: 'Official national organisation',
      findings: 'Skill 09: English individual tasks. Regionals: 3 hours, desktop and database tasks. Nationals: 7 hours, individual and connected frontend, API, database, data-processing, interface/format and speed tasks; Java or .NET. National aids and equipment: details pending.',
    },
    {
      title: 'Skill 09 — participant guidance',
      url: 'https://skills-for-ict-professions.jimdosite.com/skill-09/',
      type: 'Participant site linked by ICT-Berufsbildung',
      findings: 'Regional guidance prioritises working functionality in the supplied Windows VM and delivery of source, executable, database schema/data and a README. A public link points to the previous regional task. The detailed national sections still say information will follow.',
    },
    {
      title: 'ICT-Berufsbildung Zentralschweiz — regionals 2026',
      url: 'https://www.ict-bz.ch/event/rm-ict-2026',
      type: 'Regional organiser',
      findings: 'The organiser confirms a three-hour regional task, English as the examination language and qualification to nationals through regional results.',
    },
  ],
  unknown: 'No complete 2027 national brief, marking scheme or final environment was verified. Linked OneDrive task archives could not be inspected through the research tools. No official task text, private VM or competition assets are bundled here.',
};

export const toolIdeas = [
  { number: '01', title: 'DeskState', tag: 'Mac app · daily utility', description: 'Save a project’s folders, repositories, browser links and approved launch commands as a workspace. Restore them in one click. Start with folders and links; add app automation only where permissions allow it.', time: 'First version: 1–2 weekends' },
  { number: '02', title: 'Proofpack', tag: 'Website · portfolio & coursework', description: 'Turn a finished project into an evidence pack: screenshots, test output, commit links, rubric evidence and a polished project page. Keep source evidence attached so the app never invents accomplishments.', time: 'First version: 1–2 weekends' },
  { number: '03', title: 'BugLens', tag: 'Mac + iPhone · developer tool', description: 'Capture a bug with screenshots, reproduction steps and device details. Export a clean report. Begin with manual capture and a great editor; add screenshot comparison once the reporting workflow is useful.', time: 'First version: 2 weekends' },
  { number: '04', title: 'ExplainBack', tag: 'iPhone · speaking practice', description: 'Record a 90-second explanation of code or architecture, assess it against a clear rubric, then retry weak topics. A useful first version needs recording, playback and self-review; AI feedback is optional.', time: 'First version: a weekend' },
  { number: '05', title: 'Borrowed', tag: 'iPhone · personal utility', description: 'Track the things you lend: a photo, borrower, due date and return reminder. Keep the first version local, with explicit sharing. It is useful from day one without building a social network.', time: 'First version: a weekend' },
];
