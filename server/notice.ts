/**
 * Shown on the child's device before it reports anything, and always available from the
 * device's home screen. Monitoring in this app is never hidden from the person monitored.
 */
export const MONITORING_NOTICE = {
  version: 1,
  title: 'This device is connected to Family Safety Hub',
  summary:
    'A parent or guardian can see a summary of how this device is used. Nothing is hidden from you: ' +
    'this screen always shows exactly what they can see.',
  collected: [
    'How many minutes each app or website was used per day',
    'The daily time limit, bedtime and blocked sites set for your profile',
    'Requests for extra time that you send',
    'Check-in messages that you choose to send',
  ],
  notCollected: [
    'The content of messages, emails, calls, photos or files',
    'Keystrokes, passwords or screenshots',
    'Your location',
  ],
  whoCanSee: 'Only the parent or guardian account that set up this device.',
  yourControls:
    'You can see your own usage and remaining time, ask for extra time, and send a check-in at any time from this screen.',
} as const;
