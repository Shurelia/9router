/**
 * Utility helpers for ModelSelectModal
 */

/**
 * Get CSS classes for model pills in ModelSelectModal based on selection and test status.
 *
 * @param {object} params
 * @param {boolean} [params.isPlaceholder]
 * @param {boolean} [params.isSelected]
 * @param {boolean} [params.isAdded]
 * @param {"ok"|"error"|"testing"|null|undefined} [params.testStatus]
 * @returns {string} CSS classes
 */
export function getModelButtonClass({ isPlaceholder, isSelected, isAdded, testStatus }) {
  if (isPlaceholder) {
    return "border-dashed border-border text-text-muted hover:border-primary/50 hover:text-primary bg-surface italic";
  }

  const baseActive = "bg-primary text-white";
  const baseInactive = "bg-surface text-text-main";

  if (testStatus === "ok") {
    if (isSelected || isAdded) {
      return `${baseActive} border-green-500 ring-2 ring-green-400/80 hover:bg-primary-hover`;
    }
    return `${baseInactive} border-green-500 ring-1 ring-green-500/40 bg-green-500/5 hover:bg-green-500/10 hover:border-green-500`;
  }

  if (testStatus === "error") {
    if (isSelected || isAdded) {
      return `${baseActive} border-red-500 ring-2 ring-red-400/80 hover:bg-primary-hover`;
    }
    return `${baseInactive} border-red-500 ring-1 ring-red-500/40 bg-red-500/5 hover:bg-red-500/10 hover:border-red-500`;
  }

  if (testStatus === "testing") {
    if (isSelected || isAdded) {
      return `${baseActive} border-primary ring-2 ring-primary/60 animate-pulse`;
    }
    return `${baseInactive} border-primary/60 ring-1 ring-primary/40 animate-pulse`;
  }

  if (isSelected) return `${baseActive} border-primary`;
  if (isAdded) return `${baseActive} border-primary hover:bg-primary-hover`;
  return `${baseInactive} border-border hover:border-primary/50 hover:bg-primary/5`;
}
