#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() {
    vega_torrent_probe::rolling_tests::run().await;
    println!("PASS: >4GiB torrent, 8MiB rolling cache, eviction, backward/forward/concurrent seeks, bounded disk");
}
