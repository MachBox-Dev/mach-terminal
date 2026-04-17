use opentelemetry::global;
use opentelemetry::trace::TracerProvider;
use opentelemetry_otlp::{Protocol, WithExportConfig};
use opentelemetry_sdk::trace::SdkTracerProvider;
use std::env;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

pub fn init() -> Result<(), String> {
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    if let Ok(endpoint) = env::var("OTEL_EXPORTER_OTLP_ENDPOINT") {
        let exporter = opentelemetry_otlp::SpanExporter::builder()
            .with_tonic()
            .with_endpoint(endpoint)
            .with_protocol(Protocol::Grpc)
            .build()
            .map_err(|error| format!("failed to create otlp exporter: {error}"))?;

        let provider = SdkTracerProvider::builder().with_batch_exporter(exporter).build();
        let tracer = provider.tracer("mach-terminal-runtime");
        global::set_tracer_provider(provider);

        tracing_subscriber::registry()
            .with(env_filter)
            .with(
                tracing_subscriber::fmt::layer()
                    .json()
                    .with_current_span(true)
                    .with_span_list(true),
            )
            .with(tracing_opentelemetry::layer().with_tracer(tracer))
            .try_init()
            .map_err(|error| format!("failed to initialize tracing subscriber: {error}"))?;
    } else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(
                tracing_subscriber::fmt::layer()
                    .json()
                    .with_current_span(true)
                    .with_span_list(true),
            )
            .try_init()
            .map_err(|error| format!("failed to initialize tracing subscriber: {error}"))?;
    }
    Ok(())
}

pub fn shutdown() {
    let _ = global::tracer_provider();
}
