type ReferenceStringSubstitute = {
    type: 'keyword'
} | {
    type: 'variable',
    name: string
};

type ReferenceString = (string | ReferenceStringSubstitute)[];

type ReferenceSource = {
    name: string,
    url: ReferenceString,
    xpath: ReferenceString,
    variables: {
        name: string,
        defaultValue: string
    }[]
};

