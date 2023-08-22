const fs = require('fs');

function parseCSVFile(
  path,
  { columnDelimiter = ';', arrayDelimiter = '|', lineDelimiter = '\r\n' } = {}
) {
  const rawData = fs.readFileSync(path, 'utf8');
  const lines = rawData.split(lineDelimiter);

  const headers = lines[0].split(columnDelimiter);

  return lines.slice(1, -1).reduce((linesAcc, rawLine, i) => {
    const line = rawLine.split(columnDelimiter);

    linesAcc.push(
      headers.reduce(
        (headersAcc, header, e) => ({
          ...headersAcc,
          [header]: line[e].includes(arrayDelimiter)
            ? line[e].split(arrayDelimiter)
            : line[e],
        }),
        {}
      )
    );

    return linesAcc;
  }, []);
}

module.exports = { parseCSVFile };
