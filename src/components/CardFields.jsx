export default function CardFields({
  card,
  game,
  onChange,
  categoryList = 'manager-categories',
}) {
  return (
    <>
      {game.cardFormat !== 'description' && (
        <label>
          Name
          <input
            required={['name', 'name-description'].includes(game.cardFormat)}
            maxLength={500}
            value={card.Name}
            onChange={(event) =>
              onChange({ ...card, Name: event.target.value })
            }
          />
        </label>
      )}
      {game.cardFormat !== 'name' && (
        <label>
          Description
          <textarea
            required={['description', 'name-description'].includes(
              game.cardFormat,
            )}
            maxLength={10000}
            rows={3}
            value={card.Description}
            onChange={(event) =>
              onChange({ ...card, Description: event.target.value })
            }
          />
        </label>
      )}
      {game.hasCategories && (
        <label>
          Category
          <input
            required
            maxLength={200}
            list={categoryList}
            value={card.Category}
            onChange={(event) =>
              onChange({ ...card, Category: event.target.value })
            }
          />
        </label>
      )}
    </>
  );
}
