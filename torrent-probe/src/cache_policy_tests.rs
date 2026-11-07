// Standalone policy tests: rustc --edition 2021 --test src/cache_policy_tests.rs.
#[path = "cache.rs"]
mod cache;
#[test]
fn least_recently_used_entry_is_evicted_and_seek_does_not_double_reserve() {
    use std::{collections::HashSet, fs, time::{Duration, SystemTime, UNIX_EPOCH}};
    let root=std::env::temp_dir().join(format!("vega-lru-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    let mib=1024*1024;
    let c=cache::Cache::new(root,100*mib).unwrap();
    let a="a".repeat(40);let b="b".repeat(40);let next="c".repeat(40);
    c.touch(&a,80*mib).unwrap();c.touch(&b,20*mib).unwrap();
    for (hash,age) in [(&a,10),(&b,20)] {
        fs::OpenOptions::new().write(true).open(c.path(hash).unwrap().join(".used")).unwrap()
            .set_times(fs::FileTimes::new().set_modified(UNIX_EPOCH+Duration::from_secs(age))).unwrap();
    }
    assert_eq!(c.plan(&next,40*mib,u64::MAX,&HashSet::new()).unwrap(),vec![a.clone()]);
    assert_eq!(c.plan(&a,80*mib,u64::MAX,&HashSet::new()).unwrap(),Vec::<String>::new());
    assert!(c.plan(&next,40*mib,u64::MAX,&HashSet::from([a.clone()])).is_err());
    fs::remove_dir_all(&c.root).unwrap();
}
