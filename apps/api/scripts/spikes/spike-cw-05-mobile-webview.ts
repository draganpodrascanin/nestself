/**
 * SPIKE-CW-05: does the ticket web route join a meeting with audio and video
 * inside the Expo app on iOS (WKWebView) and Android (Chromium WebView)?
 * (D-CW-24, CW-R-65, CORE-23, CORE-36, research/01 open question 4.)
 *
 * Instructions only: this script prints the manual procedure and makes no AWS
 * call; it still refuses a CHIME_REGION other than eu-central-1 (exit 2).
 * Variant A runs now, against the spike harness page served by SPIKE-CW-08
 * --device. Variant B repeats the check on the canonical ticket route once
 * T-CW-1.5 and T-CW-4.1 exist.
 *
 *   AWS_PROFILE=nestself-dev AWS_REGION=eu-central-1 pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-05-mobile-webview.ts
 */
import { numberArg, runPrintOnlySpike } from './lib.js';

const SIMULATOR = 'NestSelf iPhone';
const IOS_VERSION = '17.5';

runPrintOnlySpike(
  {
    meta: {
      id: 'SPIKE-CW-05',
      file: 'spike-cw-05-mobile-webview.ts',
      question: 'Does the ticket web route join a meeting with audio and video inside the Expo app on iOS (WKWebView) and Android?',
      binds: ['D-CW-24'],
    },
    options: { port: { type: 'string', default: '5199', description: 'Harness port used in the printed commands' } },
    help: ['Prints the manual procedure for the simulator and a physical Android device. Makes no AWS call.'],
  },
  (args) => {
    const port = numberArg(args, 'port', 5199);
    const harnessUrl = `http://127.0.0.1:${port}/?slot=device`;
    const text = `
Why loopback: getUserMedia only works in a secure context. http://127.0.0.1 and http://localhost are secure;
a LAN address such as http://192.168.x.x is not, so the camera and microphone would be unavailable.
The iOS Simulator shares the Mac's loopback; a physical Android phone reaches it through \`adb reverse\`.

PREREQUISITES
  1. Xcode with the "${SIMULATOR}" simulator (iOS ${IOS_VERSION}) and Expo Go installed on it.
  2. One physical Android phone with USB debugging on, Expo Go installed, and \`adb\` on the PATH (\`adb devices\` lists it).
     A physical iPhone as well, if one is available: the Simulator has no camera, so camera capture on iOS can only be
     confirmed on a device (research/01 open question 4).
  3. react-native-webview in apps/mobile. The catalog pins it (react-native-webview 14.0.1, T-CW-0.1) and T-CW-4.1 adds it to
     apps/mobile/package.json. Before T-CW-4.1, add "react-native-webview": "catalog:" to apps/mobile/package.json and run
     \`pnpm install\` only at a moment when no parallel work is running (repository rule), then revert after the spike.
  4. A temporary screen, not committed: apps/mobile/src/app/spike-webview.tsx

       import { WebView } from 'react-native-webview';

       export default function SpikeWebView() {
         return (
           <WebView
             source={{ uri: '${harnessUrl}' }}
             originWhitelist={['*']}
             javaScriptEnabled
             allowsInlineMediaPlayback
             mediaPlaybackRequiresUserAction={false}
             mediaCapturePermissionGrantType="prompt"
             style={{ flex: 1 }}
           />
         );
       }

     "prompt" makes iOS show its permission prompt inside the WebView, which is one of the things to observe.

VARIANT A: SPIKE HARNESS (runs now; no call route needed)
  1. Start a meeting with a Chromium far end and a slot for the phone, and leave it running:
       AWS_PROFILE=nestself-dev AWS_REGION=eu-central-1 pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-08-playwright-ci.ts --device --port ${port} --minutes 20
     It prints every event the phone's page reports (permission grants, audioVideoDidStart, remote video and audio,
     visibility changes, failures) and ends with the JSON result line. Ctrl-C ends it early and still prints the result.
  2. iOS Simulator:
       xcrun simctl boot "${SIMULATOR}"   # skip if it is already booted
       open -a Simulator
       pnpm --filter @nestself/mobile start   # press i to open Expo Go in the booted simulator
       xcrun simctl openurl booted "exp://127.0.0.1:8081/--/spike-webview"
  3. Android phone (repeat step 1 first if the meeting has ended):
       adb reverse tcp:${port} tcp:${port}   # the harness page
       adb reverse tcp:8081 tcp:8081   # Metro
       pnpm --filter @nestself/mobile start
       adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081/--/spike-webview"

VARIANT B: CANONICAL TICKET ROUTE (after T-CW-1.5 and T-CW-4.1)
  The route is apps/workspace/src/routes/call/$appointmentId.tsx, opened as
  {WORKSPACE_URL}/call/{appointmentId}?ticket={ticket} (D-CW-24, guidelines section 13).
  1. API with VIDEO_PROVIDER=chime (port 4000), workspace dev server (port 5173), the mobile app in api mode
     (EXPO_PUBLIC_DATA_SOURCE=api), and a confirmed appointment inside its join window.
  2. Android: adb reverse tcp:5173 tcp:5173 and adb reverse tcp:4000 tcp:4000 so both stay on loopback.
  3. The T-CW-4.1 mobile screen calls POST /appointments/:id/call-ticket and opens the route within the ticket's
     30 seconds (CALL_TICKET_TTL_SECONDS). The expert joins from a desktop browser.
  4. Additionally observe: a reload after the ticket was consumed (expect the invalid_ticket message on screen, not a blank page).

WHAT TO OBSERVE AND RECORD (both variants, both platforms)
  1. Camera and microphone permission: which prompt appears (the WebView's or the operating system's), whether "Allow"
     persists across a reload, and what the page shows after "Don't allow" (the harness reports the error name).
  2. Join: does the terminal show audioVideoDidStart for the phone, and how long after the page opened?
  3. Media both ways: the phone shows the blue FAR END tile and plays its tone; the far end reports the phone's video
     tile and audio (remoteVideoTile and remoteAudioHeard for the phone's attendee id).
  4. Autoplay: does remote audio start without a tap? The harness shows "Tap to start audio" and reports
     audioAutoplayBlocked if it did not.
  5. Background: switch to another app or lock the screen for 30 seconds, then return. Record visibility events, whether
     audio continued in the background, whether video resumed, and any reconnecting or audioVideoDidStop events.
  6. Rotation and the keyboard: rotate once; note any layout or media interruption.
  7. Simulator only: the Simulator has no camera, so expect the camera step to fail there; record the error name and
     whether audio still works.

Record the results in docs/tasks/calls-webinars/research/07-spikes.md, section SPIKE-CW-05, one column per platform.
Delete apps/mobile/src/app/spike-webview.tsx afterwards.`;
    console.log(text);
    return { outcome: 'instructions-printed', measurements: { harnessUrl, simulator: SIMULATOR, iosVersion: IOS_VERSION } };
  },
);
