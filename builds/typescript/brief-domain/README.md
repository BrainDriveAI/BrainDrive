# Brief Builder owner-data domain

Brief Builder owns only bounded source, draft, approved-revision, lineage, and operation records under the host-derived `memory/apps/brief-builder` namespace. It does not import or alias Resume Builder, Career facts, resume rendering, or export contracts.

Approval is a host-confirmed append: each approved revision preserves its predecessor ID, and the successor relation is derived without mutating the predecessor. Failed generation, grounding, cancellation, owner editing, rejection, and persistence leave the prior approved revision unchanged. Default uninstall removes runtime authority while retaining this namespace; explicit deletion is permitted only through the lifecycle service's trusted owner-confirmation flow while uninstalled.
