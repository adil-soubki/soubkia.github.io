// Including this will add a scrolling background.

/**
 * @param {String} HTML representing a single element.
 * @param {Boolean} flag representing whether or not to trim input whitespace.
 * @return {Element | HTMLCollection | null}
 */
function fromHTML(html, trim = true) {
    // Process the HTML string.
    html = trim ? html.trim() : html;
    if (!html) return null;

    // Then set up a new template element.
    const template = document.createElement('template');
    template.innerHTML = html;
    const result = template.content.children;

    // Then return either an HTMLElement or HTMLCollection,
    // based on whether the input HTML had one or more roots.
    if (result.length === 1) return result[0];
    return result;
}

/**
 * Add supporting CSS to the head tag.
 */
function addBackgroundCSS() {
    var headElem = document.getElementsByTagName("head")[0];
    headElem.append(
        fromHTML(
            `<style>
                /* scrolling background */
                .noselect {
                    -webkit-touch-callout: none; /* iOS Safari */
                      -webkit-user-select: none; /* Safari */
                       -khtml-user-select: none; /* Konqueror HTML */
                         -moz-user-select: none; /* Old versions of Firefox */
                          -ms-user-select: none; /* Internet Explorer/Edge */
                              user-select: none; /* Non-prefixed version, currently
                                                    supported by Chrome, Edge, Opera and Firefox */
                }
                #background {
                    position: fixed;
                    width: 350vw;
                    min-width: 4160px;
                    height: 150vh;
                    transform: rotate(45deg);
                    z-index: -1;
                    font-size: 1.5rem;
                    color: #eee;
                }
                .marquee {
                    font-family: monospace;
                    text-transform: uppercase;
                }
                .marquee-line {
                    display: flex;
                    flex-flow: row nowrap;
                    align-items: center;
                    overflow: hidden;
                }

                .marquee-line .marquee {
                    white-space: nowrap;
                    animation: marquee 10s linear infinite;
                    max-width: none;
                }

                .marquee-line:nth-child(odd) .marquee {
                    animation-direction: reverse;
                }

                @keyframes marquee {
                    0% {
                        transform: translate(0, 0);
                    }
                    100% {
                        transform: translate(-100%, 0);
                    }
                }
            </style>`
        )
    )
}

/**
 * Make a scrolling background.
 */
function fillBackground() {
    bodyElem = document.getElementsByTagName("body")[0];
    bodyElem.prepend(fromHTML(`<div id="background" class="noselect"></div>`));
    addBackgroundCSS();
    var bgElem = document.getElementById("background");
    for (var i=0; i<100; i++) {
        bgElem.append(
            fromHTML(
                `<div class="marquee-line">
                    <span class="marquee">rip rip rip rip rip rip rip&nbsp;</span>
                    <span class="marquee">rip rip rip rip rip rip rip&nbsp;</span>
                    <span class="marquee">rip rip rip rip rip rip rip&nbsp;</span>
                    <span class="marquee">rip rip rip rip rip rip rip&nbsp;</span>
                    <span class="marquee">rip rip rip rip rip rip rip&nbsp;</span>
                    <span class="marquee">rip rip rip rip rip rip rip&nbsp;</span>
                </div>`
            )
        )
    }
}

/* Add the background on window loads. */
window.onload = fillBackground
