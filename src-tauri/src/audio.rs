//! System-audio reactivity. WASAPI loopback (what you hear) -> 1024-point FFT -> 32 log bands,
//! sent to the renderer ~30 times a second, and only while something is actually playing.

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct Bands {
    pub bands: Vec<f32>,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    /// The latest stretch of the waveform (512 points, -1..1), starting at a rising zero crossing
    /// so steady tones draw a still figure. Drives the Lissajous XY scope. Empty when silent.
    pub wave: Vec<f32>,
}

/// 1024 raw samples from the newest end of the buffer, aligned to a rising zero crossing and
/// decimated 2:1 to 512 points, rounded to keep the event small (~3 KB).
pub fn waveform(samples: &[f32]) -> Vec<f32> {
    const W: usize = 1024;
    if samples.len() < W + 2 {
        return Vec::new();
    }
    let latest = samples.len() - W;
    let earliest = latest.saturating_sub(W / 2);
    let start = (earliest..latest).rev().find(|&i| samples[i] <= 0.0 && samples[i + 1] > 0.0).unwrap_or(latest);
    samples[start..start + W].iter().step_by(2).map(|v| (v.clamp(-1.0, 1.0) * 1000.0).round() / 1000.0).collect()
}

/// In-place radix-2 FFT.
fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f32::consts::PI / len as f32;
        let (wr, wi) = (ang.cos(), ang.sin());
        let mut i = 0;
        while i < n {
            let (mut cr, mut ci) = (1.0f32, 0.0f32);
            for k in 0..len / 2 {
                let (a, b) = (i + k, i + k + len / 2);
                let (xr, xi) = (re[b] * cr - im[b] * ci, re[b] * ci + im[b] * cr);
                re[b] = re[a] - xr;
                im[b] = im[a] - xi;
                re[a] += xr;
                im[a] += xi;
                let t = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = t;
            }
            i += len;
        }
        len <<= 1;
    }
}

pub fn analyse(samples: &[f32], rate: f32) -> Bands {
    const N: usize = 1024;
    let mut re = vec![0.0f32; N];
    let mut im = vec![0.0f32; N];
    let off = samples.len().saturating_sub(N);
    for (i, s) in samples[off..].iter().enumerate() {
        let w = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (N - 1) as f32).cos();
        re[i] = s * w;
    }
    fft(&mut re, &mut im);
    let mag: Vec<f32> = (0..N / 2)
        .map(|i| (re[i] * re[i] + im[i] * im[i]).sqrt() / N as f32)
        .collect();
    let hz = rate / N as f32;
    let (lo, hi) = (30.0f32, 16000.0f32);
    let mut bands = Vec::with_capacity(32);
    for b in 0..32 {
        let f0 = lo * (hi / lo).powf(b as f32 / 32.0);
        let f1 = lo * (hi / lo).powf((b + 1) as f32 / 32.0);
        let (i0, i1) = (
            ((f0 / hz) as usize).max(1),
            ((f1 / hz) as usize).clamp(2, N / 2),
        );
        let peak = mag[i0.min(i1 - 1)..i1]
            .iter()
            .cloned()
            .fold(0.0f32, f32::max);
        // perceptual-ish scaling, then squash into 0..1
        let v = (peak * 40.0 * (1.0 + b as f32 * 0.06)).sqrt();
        bands.push((v / (1.0 + v)).min(1.0));
    }
    let avg = |a: usize, b: usize| bands[a..b].iter().sum::<f32>() / (b - a) as f32;
    Bands {
        bass: avg(0, 6),
        mid: avg(6, 18),
        treble: avg(18, 32),
        bands,
        wave: waveform(samples),
    }
}

#[cfg(windows)]
pub fn spawn(app: tauri::AppHandle) {
    use crate::AppState;
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use tauri::{Emitter, Manager};

    std::thread::Builder::new()
        .name("echelon-audio".into())
        .spawn(move || {
            let buf: Arc<Mutex<VecDeque<f32>>> =
                Arc::new(Mutex::new(VecDeque::with_capacity(4096)));
            let failed = Arc::new(AtomicBool::new(false));
            let mut stream: Option<cpal::Stream> = None;
            let mut rate = 48000.0f32;
            let mut last_sound = Instant::now() - Duration::from_secs(10);
            let mut sent_silence = true;
            let mut retry_at = Instant::now();
            loop {
                let (want, quitting) = {
                    let st = app.state::<AppState>();
                    let cfg = st.cfg.lock().unwrap();
                    let vis = st.vis.lock().unwrap();
                    (
                        cfg.system.audio
                            && !cfg.paused
                            && !vis.hibernating
                            && !vis.all_covered
                            && !vis.locked
                            && !(vis.on_battery && cfg.system.battery == "pause"),
                        st.quitting.load(Ordering::Relaxed),
                    )
                };
                if quitting {
                    return;
                }
                if failed.swap(false, Ordering::Relaxed) {
                    stream = None; // device changed (headphones plugged in, etc.): reopen
                    retry_at = Instant::now() + Duration::from_secs(1);
                }
                if want && stream.is_none() && Instant::now() >= retry_at {
                    let open = || -> Result<(cpal::Stream, f32), String> {
                        let dev = cpal::default_host()
                            .default_output_device()
                            .ok_or("no output device")?;
                        let cfg = dev.default_output_config().map_err(|e| e.to_string())?;
                        let ch = cfg.channels() as usize;
                        let r = cfg.sample_rate().0 as f32;
                        let (b, f) = (buf.clone(), failed.clone());
                        let push = move |data: &[f32]| {
                            if let Ok(mut q) = b.lock() {
                                for frame in data.chunks(ch.max(1)) {
                                    q.push_back(frame.iter().sum::<f32>() / ch.max(1) as f32);
                                }
                                while q.len() > 2048 {
                                    q.pop_front();
                                }
                            }
                        };
                        let err = move |_e| f.store(true, Ordering::Relaxed);
                        // Building an *input* stream on an *output* device = WASAPI loopback.
                        let s = match cfg.sample_format() {
                            cpal::SampleFormat::F32 => dev.build_input_stream(
                                &cfg.into(),
                                move |d: &[f32], _: &_| push(d),
                                err,
                                None,
                            ),
                            cpal::SampleFormat::I16 => {
                                let mut tmp = Vec::new();
                                dev.build_input_stream(
                                    &cfg.into(),
                                    move |d: &[i16], _: &_| {
                                        tmp.clear();
                                        tmp.extend(d.iter().map(|v| *v as f32 / 32768.0));
                                        push(&tmp)
                                    },
                                    err,
                                    None,
                                )
                            }
                            _ => return Err("unsupported sample format".into()),
                        }
                        .map_err(|e| e.to_string())?;
                        s.play().map_err(|e| e.to_string())?;
                        Ok((s, r))
                    };
                    match open() {
                        Ok((s, r)) => {
                            stream = Some(s);
                            rate = r;
                        }
                        Err(_) => retry_at = Instant::now() + Duration::from_secs(5),
                    }
                }
                if !want && stream.is_some() {
                    stream = None;
                    buf.lock().unwrap().clear();
                }
                if stream.is_some() {
                    let samples: Vec<f32> = buf.lock().unwrap().iter().cloned().collect();
                    let loud = samples.iter().any(|s| s.abs() > 0.002);
                    if loud {
                        last_sound = Instant::now();
                    }
                    if last_sound.elapsed() < Duration::from_millis(400) {
                        let _ = app.emit("audio", analyse(&samples, rate));
                        sent_silence = false;
                    } else if !sent_silence {
                        let _ = app.emit(
                            "audio",
                            Bands {
                                bands: vec![0.0; 32],
                                bass: 0.0,
                                mid: 0.0,
                                treble: 0.0,
                                wave: Vec::new(),
                            },
                        );
                        sent_silence = true;
                        buf.lock().unwrap().clear();
                    }
                }
                std::thread::sleep(Duration::from_millis(if stream.is_some() {
                    33
                } else {
                    500
                }));
            }
        })
        .ok();
}

#[cfg(not(windows))]
pub fn spawn(_app: tauri::AppHandle) {}

#[cfg(test)]
mod tests {
    #[test]
    fn sine_lands_in_bass() {
        let rate = 48000.0;
        let s: Vec<f32> = (0..1024)
            .map(|i| (2.0 * std::f32::consts::PI * 60.0 * i as f32 / rate).sin() * 0.5)
            .collect();
        let b = super::analyse(&s, rate);
        assert!(
            b.bass > b.treble * 2.0,
            "bass {} treble {}",
            b.bass,
            b.treble
        );
    }

    #[test]
    fn waveform_is_512_points_starting_at_a_rising_zero_crossing() {
        let rate = 48000.0;
        let s: Vec<f32> = (0..2048)
            .map(|i| (2.0 * std::f32::consts::PI * 220.0 * i as f32 / rate).sin() * 0.5)
            .collect();
        let w = super::waveform(&s);
        assert_eq!(w.len(), 512);
        assert!(w[0].abs() < 0.05 && w[1] > w[0], "starts near zero and rising: {} {}", w[0], w[1]);
        assert!(super::waveform(&s[..500]).is_empty());
    }
}
