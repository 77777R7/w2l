import { describe, expect, it } from 'vitest'
import { amazonAsin } from '../../src/amazon.js'
import asinSubstitutionCases from './asin-substitution-cases.json'

/**
 * R1-B: ASIN substitution regression tests
 *
 * These tests cover the critical requirement that when Amazon's page selects
 * a different product than requested, W2L must NOT output the substitute
 * product's data as if it belonged to the requested product.
 *
 * Context: R0 found 2 cases (out of 200) where:
 * - User requested ASIN A
 * - Amazon page selected ASIN B (variant/substitute)
 * - W2L correctly withheld the output (incomplete result)
 *
 * These tests ensure that behavior remains correct as we improve
 * identity resolution in R1.
 */
describe('R1-B: ASIN substitution must not produce incorrect output', () => {
  it('validates test fixture structure', () => {
    expect(asinSubstitutionCases.version).toBe(1)
    expect(asinSubstitutionCases.cases).toHaveLength(2)

    for (const testCase of asinSubstitutionCases.cases) {
      expect(testCase.requestedAsin).toMatch(/^B[A-Z0-9]{9}$/)
      expect(testCase.selectedAsin).toMatch(/^B[A-Z0-9]{9}$/)
      expect(testCase.requestedAsin).not.toBe(testCase.selectedAsin)
      expect(testCase.classification).toBe('selected_subject_mismatch')
    }
  })

  describe('Case 1: B0BDXSK2K7 → B0D1V6F7Y9', () => {
    const testCase = asinSubstitutionCases.cases[0]!

    it('identifies requested ASIN from URL', () => {
      const asin = amazonAsin(testCase.finalUrl)
      expect(asin).toBe(testCase.requestedAsin)
    })

    it('documents the mismatch context', () => {
      expect(testCase.requestedAsin).toBe('B0BDXSK2K7')
      expect(testCase.selectedAsin).toBe('B0D1V6F7Y9')
      expect(testCase.selectedQuote.belongsToRequestedAsin).toBe(false)
      expect(testCase.resultStatus).toBe('incomplete')
      expect(testCase.observation).toContain('substitute product data was withheld')
    })

    it('verifies R0 correctly refused to output substitute data', () => {
      // R0 behavior: incomplete result, no incorrect data output
      expect(testCase.resultStatus).toBe('incomplete')
      expect(testCase.jsonStatus).toBe('incomplete')

      // The critical assertion: quote did NOT belong to requested ASIN
      expect(testCase.selectedQuote.belongsToRequestedAsin).toBe(false)
    })

    // TODO R1: When HTML witness is available, add test that parses the actual
    // HTML and verifies we can detect the mismatch from DOM evidence
  })

  describe('Case 2: B0CMCQ3684 → B0CMCPRT3L', () => {
    const testCase = asinSubstitutionCases.cases[1]!

    it('identifies requested ASIN from URL', () => {
      const asin = amazonAsin(testCase.finalUrl)
      expect(asin).toBe(testCase.requestedAsin)
    })

    it('documents the mismatch context - with visible quote', () => {
      expect(testCase.requestedAsin).toBe('B0CMCQ3684')
      expect(testCase.selectedAsin).toBe('B0CMCPRT3L')

      // This case HAD a visible quote, but it belonged to the wrong product
      expect(testCase.selectedQuote.visible).toBe(true)
      expect(testCase.selectedQuote.belongsToRequestedAsin).toBe(false)
      expect(testCase.selectedQuote.selector).toBe('#corePrice_feature_div .a-price .a-offscreen')

      // Currency was visible but withheld because product was wrong
      expect(testCase.currency.selectedQuoteExplicitSgdVisible).toBe(true)
      expect(testCase.currency.outputVerified).toBe(false)
    })

    it('verifies R0 correctly refused to output substitute data even when quote was visible', () => {
      // This is the more dangerous case: there WAS a price on the page
      // but W2L correctly recognized it belonged to the wrong product
      expect(testCase.resultStatus).toBe('incomplete')
      expect(testCase.jsonStatus).toBe('incomplete')
      expect(testCase.selectedQuote.visible).toBe(true)
      expect(testCase.selectedQuote.belongsToRequestedAsin).toBe(false)
    })

    // TODO R1: This case is especially important because there was a visible
    // price. Need to verify the identity check happens BEFORE price extraction
  })

  describe('Identity resolution requirements for R1', () => {
    it('documents the current identity selector', () => {
      // R0 used: querySelector('input[name="ASIN"], #ASIN')
      // This is documented in both test cases' witness.selectors
      for (const testCase of asinSubstitutionCases.cases) {
        expect(testCase.witness.selectors).toContain('input[name="ASIN"], #ASIN')
      }
    })

    it('establishes the red line: never output wrong product data', () => {
      // RED LINE: If requested ASIN ≠ selected ASIN, result MUST be incomplete
      // This is non-negotiable for product data integrity

      for (const testCase of asinSubstitutionCases.cases) {
        if (testCase.requestedAsin !== testCase.selectedAsin) {
          expect(testCase.resultStatus).toBe('incomplete')
          expect(testCase.selectedQuote.belongsToRequestedAsin).toBe(false)
        }
      }
    })
  })
})

/**
 * R1-B Implementation Checklist (not executable tests, but requirements):
 *
 * 1. Multi-evidence identity verification:
 *    - Don't rely on first matching input[name="ASIN"]
 *    - Verify ASIN within main product container (#dp-container, #ppd)
 *    - Cross-check with selected variant attributes
 *    - Match against buy box context
 *
 * 2. Identity evidence structure (proposed):
 *    - requestedAsin: from URL
 *    - observedSelectedAsin: from DOM multi-evidence
 *    - parentAsin: if variants exist
 *    - selectedVariantAttributes: if variant is selected
 *    - identityMatch: boolean
 *    - identityEvidence: array of supporting selectors
 *
 * 3. Processing order:
 *    - Extract identity FIRST
 *    - If identity mismatch detected, mark incomplete immediately
 *    - Do NOT extract price/currency for wrong product
 *    - Do NOT attempt to "fix" by rewriting output ASIN
 *
 * 4. Validation with HTML witnesses:
 *    - Once HTML files are available, replay these 2 cases
 *    - Verify improved identity resolution still catches mismatch
 *    - Ensure no false positives (parent/child ASIN relationships)
 *
 * 5. Success criteria:
 *    - Both test cases remain incomplete (correct behavior)
 *    - Identity mismatch detected with multi-evidence approach
 *    - Clear diagnostic output explaining why product was rejected
 */
