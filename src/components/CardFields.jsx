import { useId } from 'react';
import { CARD_LIMITS } from '../utils/cardFormats';

// Labels point at their controls by id rather than wrapping them, so a field's
// accessible name never picks up the text already typed into it.
export default function CardFields({
  card,
  game,
  onChange,
  categoryList = 'manager-categories',
  categoryRequired = true,
}) {
  const id = useId();
  return (
    <>
      {game.cardFormat !== 'description' && (
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input
            id={`${id}-name`}
            required={['name', 'name-description'].includes(game.cardFormat)}
            maxLength={CARD_LIMITS.Name}
            value={card.Name}
            onChange={(event) =>
              onChange({ ...card, Name: event.target.value })
            }
          />
        </div>
      )}
      {game.cardFormat !== 'name' && (
        <div className="field">
          <label htmlFor={`${id}-description`}>Description</label>
          <textarea
            id={`${id}-description`}
            required={['description', 'name-description'].includes(
              game.cardFormat,
            )}
            maxLength={CARD_LIMITS.Description}
            rows={3}
            value={card.Description}
            onChange={(event) =>
              onChange({ ...card, Description: event.target.value })
            }
          />
        </div>
      )}
      {game.hasCategories && (
        <div className="field">
          <label htmlFor={`${id}-category`}>
            Category{!categoryRequired && ' (optional)'}
          </label>
          <input
            id={`${id}-category`}
            required={categoryRequired}
            maxLength={CARD_LIMITS.Category}
            list={categoryList}
            value={card.Category}
            onChange={(event) =>
              onChange({ ...card, Category: event.target.value })
            }
          />
        </div>
      )}
    </>
  );
}
