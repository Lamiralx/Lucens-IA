"""Remplace le SCHEMA dans api/analyze.js par le nouveau spec V21
   (analyse contextuelle pédagogique)."""
import sys
from pathlib import Path

NEW_SCHEMA = """const SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string" },
    /* V21 — analyzable : false si photo hors scope inspection UV-A 365 nm */
    analyzable: { type: "boolean" },
    reason_not_analyzable: { type: "string" },

    /* V21 — Contexte utilisateur récupéré (echo) */
    input_context: {
      type: "object",
      properties: {
        sector:             { type: "string" },
        surface_type:       { type: "string" },
        surface_role:       { type: "string" },
        analysis_objective: { type: "string" },
      },
      required: ["sector", "surface_type", "surface_role", "analysis_objective"],
      additionalProperties: false,
    },

    /* V21 — Résultat principal : identité probable du signal */
    result: {
      type: "object",
      properties: {
        title:            { type: "string" },
        probable_identity:{ type: "string" },
        signal_nature:    { type: "string" },
        confidence_label: { type: "string" },
        interpretation:   { type: "string" },
      },
      required: ["title", "probable_identity", "signal_nature", "confidence_label", "interpretation"],
      additionalProperties: false,
    },

    /* V21 — Raisonnement contextuel */
    contextual_reasoning: {
      type: "object",
      properties: {
        surface_logic:                 { type: "string" },
        risk_logic:                    { type: "string" },
        what_fluorescence_suggests:    { type: "string" },
        what_fluorescence_does_not_prove: { type: "string" },
      },
      required: ["surface_logic", "risk_logic", "what_fluorescence_suggests", "what_fluorescence_does_not_prove"],
      additionalProperties: false,
    },

    /* V21 — Recommandation actionnable */
    recommendation: {
      type: "object",
      properties: {
        title:              { type: "string" },
        primary_action:     { type: "string" },
        why_this_action:    { type: "string" },
        follow_up:          { type: "string" },
        sector_adaptation:  { type: "string" },
        confirmation_if_needed: { type: "string" },
      },
      required: ["title", "primary_action", "why_this_action", "follow_up", "sector_adaptation", "confirmation_if_needed"],
      additionalProperties: false,
    },

    /* V21 — Point de vigilance */
    point_of_vigilance: {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
      additionalProperties: false,
    },

    /* V21 — Référentiels applicables au cas */
    reference_logic: {
      type: "object",
      properties: {
        applicable_frameworks: { type: "array", items: { type: "string" } },
        explanation:           { type: "string" },
      },
      required: ["applicable_frameworks", "explanation"],
      additionalProperties: false,
    },

    /* V21 — Métadonnées rapport PDF */
    report: {
      type: "object",
      properties: {
        include_original_image:  { type: "boolean" },
        include_annotated_image: { type: "boolean" },
        summary_for_pdf:         { type: "string" },
      },
      required: ["include_original_image", "include_annotated_image", "summary_for_pdf"],
      additionalProperties: false,
    },

    /* V21 — Zones[] conservées pour cartographie visuelle.
       Le rendu UI principal s'appuie sur result + recommendation,
       mais zones[] reste utile pour annoter l'image. */
    zones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:                { type: "string" },
          label:             { type: "string" },
          intensity:         { type: "string" },
          area_pct:          { type: "number" },
          risk_score:        { type: "integer" },
          confidence:        { type: "number" },
          bbox_normalized: {
            type: "object",
            properties: {
              x: { type: "number" }, y: { type: "number" },
              w: { type: "number" }, h: { type: "number" },
            },
            required: ["x", "y", "w", "h"],
            additionalProperties: false,
          },
          evidence:          { type: "string" },
          artifact_rejection:{ type: "string" },
        },
        required: ["id", "label", "bbox_normalized", "area_pct", "intensity", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["language", "analyzable", "result", "contextual_reasoning", "recommendation", "point_of_vigilance", "reference_logic", "report", "zones"],
  additionalProperties: false,
};"""

def main():
    root = Path(__file__).resolve().parent.parent
    path = root / 'api' / 'analyze.js'
    text = path.read_text(encoding='utf-8')

    start_marker = 'const SCHEMA = {'
    end_marker = '\n};\n'

    start_idx = text.find(start_marker)
    if start_idx == -1:
        print('ERREUR : SCHEMA introuvable')
        sys.exit(1)
    # End : the next `\n};\n` after start
    end_idx = text.find(end_marker, start_idx)
    if end_idx == -1:
        print('ERREUR : fin SCHEMA introuvable')
        sys.exit(1)
    end_full = end_idx + len(end_marker)

    old_len = end_full - start_idx
    print(f'Ancien SCHEMA: {old_len} chars')

    new_text = text[:start_idx] + NEW_SCHEMA + '\n' + text[end_full:]
    backup = path.with_suffix('.js.v21-schema-backup')
    backup.write_bytes(text.encode('utf-8'))
    path.write_text(new_text, encoding='utf-8', newline='')
    print(f'Nouveau SCHEMA: {len(NEW_SCHEMA)} chars')
    print(f'Backup: {backup}')

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
