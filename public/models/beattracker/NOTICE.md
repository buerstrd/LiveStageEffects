# Beat tracking model notice

The browser beat-tracking runtime in `public/workers/beattracker` is adapted
from BeatTrackerJS:

- Source: https://github.com/mathigatti/BeatTrackerJS
- Revision: 854e279f6ffe2306e835d9267fb25fc780431adb
- Project license stated by the source project: MIT

The neural model and beat-tracking parameters are from madmom:

- Source: https://github.com/CPJKU/madmom
- Model/data license: Creative Commons
  Attribution-NonCommercial-ShareAlike 4.0
- License: https://creativecommons.org/licenses/by-nc-sa/4.0/

The model files are redistributed without numerical modification. The
surrounding worker protocol and integration code are specific to LiveStage
Effects. The JavaScript beat-grid range was adjusted from 70-180 BPM to
55-200 BPM to match the application's BPM indicator.
