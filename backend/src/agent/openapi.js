// OpenAPI 3.1 description of the agent API. docs/openapi.json is generated from this
// (`npm run openapi`); a test keeps the two in sync.

const ref = (n) => ({ $ref: `#/components/schemas/${n}` })
const json = (schema) => ({ content: { 'application/json': { schema } } })
const intArr = { type: 'array', items: { type: 'integer' } }
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
const jpeg = (description) => ({ description, content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } })
const errs = { 401: { $ref: '#/components/responses/Unauthorized' }, 422: { $ref: '#/components/responses/ValidationFailed' } }

const q = (name, schema, description) => ({ name, in: 'query', schema, ...(description ? { description } : {}) })

export function buildOpenApi(version) {
  const updateProps = {
    add_tag_ids: intArr, remove_tag_ids: intArr, set_tag_ids: { ...intArr, description: 'Replace all non-system tags.' },
    add_tags: { type: 'array', items: ref('TagRef'), description: 'Add tags by category + name.' },
    remove_tags: { type: 'array', items: ref('TagRef') },
    set_category_tags: {
      type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      description: 'Replace the tags in only the named categories, e.g. {"Video Type":["Explainer"]}. An empty array clears the category.',
    },
    notes: { type: ['string', 'null'] },
    notes_mode: { type: 'string', enum: ['replace', 'append'], default: 'replace' },
    folder_id: { type: ['integer', 'null'], description: 'null unfiles the file.' },
    folder_path: { type: 'string', description: 'e.g. "Brands/Acme". Created when create_missing is true.' },
    favorite: { type: 'boolean' },
    mark_reviewed: { type: 'boolean', description: 'Stamp agent_reviewed_at; also marks reviewed unless the user requires confirmation.' },
  }
  const flags = {
    create_missing: { type: 'boolean', default: false, description: 'Create categories, tags and folders that do not exist.' },
    dry_run: { type: 'boolean', default: false, description: 'Validate and preview; write nothing.' },
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'MotionBase Agent API', version,
      description: 'Token-authenticated API for AI agents to triage, tag and organise a MotionBase library. All writes are logged and can be reverted from the UI.',
    },
    servers: [{ url: '/api/agent/v1' }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/': { get: { summary: 'API index', security: [], responses: { 200: { description: 'Index' } } } },
      '/openapi.json': { get: { summary: 'This document', security: [], responses: { 200: { description: 'OpenAPI document' } } } },
      '/status': { get: { summary: 'Counts per review status, lease count, settings, ffmpeg availability', responses: { 200: { description: 'Status' }, ...errs } } },
      '/taxonomy': { get: { summary: 'Categories (with tags, descriptions, selection mode) and folders', responses: { 200: { description: 'Taxonomy' }, 401: errs[401] } } },
      '/files': {
        get: {
          summary: 'List files (cursor pagination by id)',
          parameters: [
            q('status', { type: 'string', enum: ['pending', 'untagged', 'needs_review', 'agent_reviewed', 'reviewed', 'all'], default: 'all' }),
            q('folder', { type: 'string' }, 'Folder id, folder path ("A/B") or "none" for unfiled.'),
            q('subfolders', { type: 'string', enum: ['0', '1'], default: '1' }),
            q('tags', { type: 'string' }, 'Comma-separated tag ids (AND across categories, OR within).'),
            q('search', { type: 'string' }), q('favorites', { type: 'string', enum: ['1'] }),
            q('uploader', { type: 'string' }, 'User id of the uploader, or "none" for unknown.'),
            q('limit', { type: 'integer', minimum: 1, maximum: 200, default: 50 }),
            q('cursor', { type: 'integer' }, 'next_cursor from the previous page.'),
          ],
          responses: { 200: { description: 'Page of files', ...json({ type: 'object', properties: { files: { type: 'array', items: ref('File') }, total: { type: 'integer' }, next_cursor: { type: ['integer', 'null'] } } }) }, 401: errs[401] },
        },
      },
      '/files/{id}': {
        parameters: [idParam],
        get: { summary: 'Get a file', responses: { 200: { description: 'File', ...json(ref('File')) }, 404: { description: 'Not found' }, 401: errs[401] } },
        patch: {
          summary: 'Update one file', requestBody: { required: true, ...json({ type: 'object', properties: { ...updateProps, ...flags } }) },
          responses: { 200: { description: 'Applied (see results) plus the updated file' }, ...errs },
        },
      },
      '/files/{id}/frames': { parameters: [idParam], get: { summary: 'Evenly spaced frame list with timestamps and URLs', parameters: [q('count', { type: 'integer', maximum: 16, default: 8 }), q('width', { type: 'integer', maximum: 1024, default: 640 })], responses: { 200: { description: 'Frames' }, 503: { description: 'ffmpeg unavailable' } } } },
      '/files/{id}/frames/{i}.jpg': { parameters: [idParam, { name: 'i', in: 'path', required: true, schema: { type: 'integer' } }], get: { summary: 'One frame as JPEG', parameters: [q('count', { type: 'integer', maximum: 16, default: 8 }), q('width', { type: 'integer', maximum: 1024, default: 640 })], responses: { 200: jpeg('Frame'), 404: { description: 'Out of range' }, 503: { description: 'ffmpeg unavailable' } } } },
      '/files/{id}/contact-sheet.jpg': { parameters: [idParam], get: { summary: 'Grid of evenly spaced frames in one JPEG (longest side <= 1568px). Header X-Frame-Times lists each tile timestamp.', parameters: [q('count', { type: 'integer', maximum: 16, default: 9 }), q('cols', { type: 'integer', default: 3 })], responses: { 200: jpeg('Contact sheet'), 503: { description: 'ffmpeg unavailable' } } } },
      '/files/{id}/thumbnail.jpg': { parameters: [idParam], get: { summary: 'Stored thumbnail', responses: { 200: jpeg('Thumbnail'), 404: { description: 'No thumbnail' } } } },
      '/files/bulk': {
        post: {
          summary: 'Update up to 500 files atomically (validate all, then apply)',
          requestBody: { required: true, ...json({ type: 'object', required: ['updates'], properties: { updates: { type: 'array', maxItems: 500, items: { type: 'object', required: ['file_id'], properties: { file_id: { type: 'integer' }, ...updateProps } } }, ...flags } }) },
          responses: { 200: { description: 'Applied or previewed', ...json(ref('BatchResult')) }, ...errs },
        },
      },
      '/files/apply': {
        post: {
          summary: 'Apply one identical change to many files',
          requestBody: { required: true, ...json({ type: 'object', required: ['file_ids'], properties: { file_ids: intArr, ...updateProps, ...flags } }) },
          responses: { 200: { description: 'Applied or previewed', ...json(ref('BatchResult')) }, ...errs },
        },
      },
      '/files/review': {
        post: {
          summary: 'Mark files reviewed by the agent',
          requestBody: { required: true, ...json({ type: 'object', required: ['file_ids'], properties: { file_ids: intArr, dry_run: flags.dry_run } }) },
          responses: { 200: { description: 'Applied or previewed', ...json(ref('BatchResult')) }, ...errs },
        },
      },
      '/queue/claim': {
        post: {
          summary: 'Lease a batch of files so parallel agents do not overlap',
          requestBody: { ...json({ type: 'object', properties: { limit: { type: 'integer', maximum: 100, default: 10 }, lease_seconds: { type: 'integer', minimum: 30, maximum: 3600, default: 900 }, status: { type: 'string', default: 'pending' }, owner: { type: 'string' } } }) },
          responses: { 200: { description: 'Claimed files' }, 401: errs[401] },
        },
      },
      '/queue/release': {
        post: {
          summary: 'Release leases (all of the owner\'s, or the given file_ids)',
          requestBody: { ...json({ type: 'object', properties: { file_ids: intArr, owner: { type: 'string' } } }) },
          responses: { 200: { description: 'Released count' }, 401: errs[401] },
        },
      },
      '/categories': { post: { summary: 'Create a category (idempotent)', requestBody: { required: true, ...json({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' }, selection: { type: 'string', enum: ['single', 'multi'], default: 'multi' } } }) }, responses: { 200: { description: 'Already existed (created: false)' }, 201: { description: 'Created (created: true)' }, 401: errs[401] } } },
      '/tags': { post: { summary: 'Create a tag (idempotent)', requestBody: { required: true, ...json({ type: 'object', required: ['name'], properties: { category_id: { type: 'integer' }, category: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, create_missing: { type: 'boolean' } } }) }, responses: { 200: { description: 'Already existed' }, 201: { description: 'Created' }, 401: errs[401] } } },
      '/folders': { post: { summary: 'Create a folder path (idempotent)', requestBody: { required: true, ...json({ type: 'object', properties: { path: { type: 'string', example: 'Brands/Acme' }, name: { type: 'string' }, parent_id: { type: 'integer' }, parent_path: { type: 'string' } } }) }, responses: { 200: { description: 'Already existed' }, 201: { description: 'Created' }, 401: errs[401] } } },
      '/activity': { get: { summary: 'Recent agent writes (newest first)', parameters: [q('limit', { type: 'integer', default: 50 }), q('cursor', { type: 'integer' }), q('id', { type: 'integer' }, 'Return one entry with before/after snapshots.')], responses: { 200: { description: 'Activity' }, 401: errs[401] } } },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Token created in Settings > Agent API (mb_...), or AGENT_API_TOKEN.' } },
      responses: {
        Unauthorized: { description: 'Missing or invalid bearer token', ...json(ref('Error')) },
        ValidationFailed: { description: 'Nothing was applied; per-item errors listed', ...json({ type: 'object', properties: { error: { type: 'string' }, errors: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, file_id: { type: 'integer' }, errors: { type: 'array', items: { type: 'string' } } } } } } }) },
      },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' } } },
        TagRef: { type: 'object', required: ['category', 'name'], properties: { category: { type: 'string' }, name: { type: 'string' } } },
        File: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, filename: { type: 'string' }, path: { type: 'string' }, file_type: { enum: ['video', 'image'] },
            duration: { type: ['number', 'null'] }, width: { type: ['integer', 'null'] }, height: { type: ['integer', 'null'] }, fps: { type: ['number', 'null'] },
            aspect_ratio: { type: ['string', 'null'] }, notes: { type: ['string', 'null'] }, is_favorite: { type: 'boolean' },
            uploader: { type: ['string', 'null'], description: 'Display name of the user who added the file; null when unknown.' }, upload_source: { type: ['string', 'null'], enum: ['user', 'import', 'scan', null] },
            folder_id: { type: ['integer', 'null'] }, folder_path: { type: ['string', 'null'] },
            tags: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, category: { type: 'string' }, source: { enum: ['user', 'agent', 'system'] } } } },
            tags_by_category: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
            review: { type: 'object', properties: { status: { enum: ['pending', 'needs_review', 'reviewed'] }, reviewed_at: { type: ['string', 'null'] }, reviewed_by: { type: ['string', 'null'] }, agent_reviewed_at: { type: ['string', 'null'] } } },
            lease: { type: ['object', 'null'], properties: { owner: { type: 'string' }, until: { type: 'string' } } },
            urls: { type: 'object', properties: { thumbnail: { type: 'string' }, frames: { type: 'string' }, contact_sheet: { type: 'string' } } },
          },
        },
        BatchResult: {
          type: 'object',
          properties: {
            dry_run: { type: 'boolean' }, applied: { type: 'integer' }, unchanged: { type: 'integer' },
            activity_id: { type: ['integer', 'null'], description: 'Revert from the UI (POST /api/activity/{id}/revert).' },
            created: { type: 'object', properties: { categories: { type: 'array', items: { type: 'string' } }, tags: { type: 'array', items: { type: 'string' } }, folders: { type: 'array', items: { type: 'string' } } } },
            results: { type: 'array', items: { type: 'object', properties: { file_id: { type: 'integer' }, changed: { type: 'boolean' }, tags_added: { type: 'array', items: { type: 'string' } }, tags_removed: { type: 'array', items: { type: 'string' } } } } },
          },
        },
      },
    },
  }
}
