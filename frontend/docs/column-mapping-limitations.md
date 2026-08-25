# Column-mapping: known limitations

## Header signature versioning

Bumping `HEADER_SIGNATURE_VERSION` (`lib/column-mapping/mapping.ts:25`) is a wholesale
invalidation switch: every previously-computed signature is prefixed with the version
(`v<N>:...`), so after a bump every old signature becomes non-matching and stored mappings
re-seed.

Mappings are EPHEMERAL React state — `columnMappings` in
`components/uploadsystem/uploadparent.tsx:135`
(`const [columnMappings, setColumnMappings] = useState<Record<string, ColumnMapping>>({})`).
They are NOT persisted to localStorage, sessionStorage, or the database (no storage load feeds
that state). Because of this, a `HEADER_SIGNATURE_VERSION` bump only affects mappings in flight
within the current upload session.

If mapping persistence is ever added, a bump becomes user-visible — saved mappings would
silently require re-mapping — and must ship with a migration note.

## Per-sheet source columns (ArcGIS)

A single canonical field cannot map to DIFFERENT source columns per sheet. See the LIMITATION
comment on `ColumnMappingField` in `lib/column-mapping/types.ts:16-20`.

`scope` (`MappingScope`) selects WHICH sheet(s) a field's explicit `sourceColumns` apply to; it
does NOT support per-sheet source-header variation. An unsatisfiable per-sheet expectation
surfaces as a per-sheet `missingRequired` in `validateMapping` rather than mis-resolving.

## Alias detection and scope

Alias auto-detection is scope-aware. A trees-only field (e.g. `lx`/`ly`) is not alias-filled on
the stems sheet: alias fill skips fields whose scope excludes the current `sheetRole` (see
`lib/column-mapping/resolution.ts`, `aliasFieldScopes` / `fieldAppliesToSheet`). Both explicit
mappings and alias detection honor field scope.
