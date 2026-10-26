import {
  isBlank,
  splitBlanks,
  splitList,
  splitSpectrum,
} from '../utils/cardText';

// Fill-in-the-blank gaps are drawn as a line and read out as "blank".
function WithBlanks({ text }) {
  return splitBlanks(text).map((part, index) =>
    isBlank(part) ? (
      <span key={index} className="blank" role="img" aria-label="blank" />
    ) : (
      part
    ),
  );
}

export function CardTitle({ text }) {
  const spectrum = splitSpectrum(text);
  if (spectrum)
    return (
      <h2
        className="spectrum"
        aria-label={`From ${spectrum[0]} to ${spectrum[1]}`}
      >
        <span aria-hidden="true">{spectrum[0]}</span>
        <span className="spectrum-bar" aria-hidden="true" />
        <span aria-hidden="true">{spectrum[1]}</span>
      </h2>
    );
  return (
    <h2 className={text.length > 40 ? 'long-name' : undefined}>
      <WithBlanks text={text} />
    </h2>
  );
}

export function CardDescription({ text, id }) {
  const items = splitList(text);
  if (items)
    return (
      <ul className="word-chips" id={id}>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    );
  const length = text.length;
  return (
    <p
      id={id}
      className={`card-description${length > 900 ? ' very-long' : length > 280 ? ' long' : ''}`}
      tabIndex={length > 280 ? 0 : undefined}
    >
      <WithBlanks text={text} />
    </p>
  );
}
