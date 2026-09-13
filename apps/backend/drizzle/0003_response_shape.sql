ALTER TABLE execution.response ADD CONSTRAINT response_shape CHECK (COALESCE(
  CASE question_type
    WHEN 'text' THEN text_value IS NOT NULL AND text_value <> ''
      AND option_ids IS NULL AND number_value IS NULL AND date_value IS NULL AND other_text IS NULL
    WHEN 'number' THEN number_value IS NOT NULL
      AND text_value IS NULL AND option_ids IS NULL AND date_value IS NULL AND other_text IS NULL
    WHEN 'date' THEN date_value IS NOT NULL
      AND text_value IS NULL AND option_ids IS NULL AND number_value IS NULL AND other_text IS NULL
    WHEN 'single_choice' THEN option_ids IS NOT NULL AND cardinality(option_ids) = 1
      AND array_position(option_ids, NULL) IS NULL
      AND text_value IS NULL AND number_value IS NULL AND date_value IS NULL
    WHEN 'multiple_choice' THEN option_ids IS NOT NULL AND cardinality(option_ids) >= 1
      AND array_position(option_ids, NULL) IS NULL
      AND text_value IS NULL AND number_value IS NULL AND date_value IS NULL
    ELSE false END, false));
