pub fn next_wallpaper(cfg: &crate::config::Config, seed: usize) -> Option<String> {
    let p = &cfg.playlist;
    let current = cfg.assign.get(&p.monitor).or_else(|| cfg.assign.get("*"));
    let available = |id: &&String| {
        cfg.item(id).is_some_and(|i| {
            i.path
                .as_ref()
                .is_none_or(|s| std::path::Path::new(s).exists())
        })
    };
    let candidates: Vec<_> = p
        .items
        .iter()
        .filter(available)
        .filter(|id| Some(*id) != current)
        .collect();
    if candidates.is_empty() {
        return None;
    }
    if p.shuffle {
        return Some(candidates[seed % candidates.len()].to_string());
    }
    let start = current
        .and_then(|id| p.items.iter().position(|v| v == id))
        .map(|n| n + 1)
        .unwrap_or(0);
    (0..p.items.len())
        .map(|n| &p.items[(start + n) % p.items.len()])
        .find(|id| candidates.contains(id))
        .cloned()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn order_wraps_and_skips_deleted_entries() {
        let mut c = crate::config::Config::default();
        c.ensure_builtins();
        c.playlist.items = vec![
            "builtin-silk".into(),
            "missing".into(),
            "builtin-fluid".into(),
        ];
        assert_eq!(next_wallpaper(&c, 0).as_deref(), Some("builtin-fluid"));
        c.assign.insert("*".into(), "builtin-fluid".into());
        assert_eq!(next_wallpaper(&c, 0).as_deref(), Some("builtin-silk"));
    }
    #[test]
    fn shuffle_never_repeats_current_and_empty_is_safe() {
        let mut c = crate::config::Config::default();
        c.ensure_builtins();
        assert_eq!(next_wallpaper(&c, 0), None);
        c.playlist.shuffle = true;
        c.playlist.items = vec![
            "builtin-silk".into(),
            "builtin-fluid".into(),
            "builtin-particles".into(),
        ];
        for seed in 0..100 {
            assert_ne!(next_wallpaper(&c, seed).as_deref(), Some("builtin-silk"));
        }
    }
}
