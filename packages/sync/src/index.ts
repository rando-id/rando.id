// PowerSync client setup lives here. The actual SDK pick differs between web
// (@powersync/web) and native (@powersync/react-native); platform-specific
// glue lives in apps/{web,native}, while this package owns the schema mirror
// and shared types.
export * from './schema'
