Synthetic video fixtures generated using FFmpeg 6.1.1, with no external footage.
`review-{rate}.mp4` uses testsrc2 at the named rate, H.264, 160x90, 1.2 seconds.
NTSC rates are exact 24000/1001, 30000/1001 and 60000/1001 fractions.
`review-vfr.mp4` selects every other frame in the first second of a 30 FPS source,
then every frame in the second second, using `-fps_mode vfr`.
`review-25fps.webm` is VP8 at 25 FPS, 320x180, 1.2 seconds.
The MP4 headers are at the tail to exercise metadata seeking.
